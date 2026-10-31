/* CMS browser remote: the PC remains the sole player and persistence owner. */
(() => {
    'use strict';
    const CONTROL = 'data-cms-remote-control';
    const BLOCKED = 'data-cms-remote-blocked';
    const selector = 'button,input,select,textarea,summary,a,[role="button"],[role="option"],.progress-container,.tab-btn,.w-f-item,.m-f-item,.w-t-item';
    const scrollSelector = '#widget-track-list,#widget-folder-list,#mobile-folder-list-modal,.cms-rec-body,.cms-rec-conditions,.cms-rec-folder-options,.tab-content,.settings-body,.stats-body';
    const pcOnly = new Set(['btn-cloud-login','btn-cloud-login-settings','btn-cloud-connect-auto','btn-cloud-connect-auto-settings','btn-cloud-signout','set-use-firebase',
        'btn-set-analysis-export-folder','btn-export-analysis-json','btn-reset-settings','btn-edit-delete','btn-edit-move',
        'btn-edit-bg-position','btn-edit-pocket-layout','pocket-layout-done','btn-toggle-edit','btn-edit-mode','btn-edit-cancel', 'btn-add-video-url']);
    let controls = new Map(), nodeKeys = new WeakMap(), revision = 0, serial = 0;
    let hostToken = '', session = null, abort = null, observer = null, timer = 0, heartbeat = 0;
    let previousSnapshot = '', publishing = false, dirty = false, commandChain = Promise.resolve();
    const handled = new Map(), peers = new Map();
    const publicationWaiters=[];
    let transportGeneration = 0;

    function signature(node) {
        const row = node.closest('.w-t-item,.w-f-item,.m-f-item,.cms-rec-row');
        const record=row?.matches('.w-t-item')?window.CmsWebPlayer?.getVisibleRecords?.()[Number(row.dataset.index)]:null;
        return [node.tagName,node.id,node.getAttribute('type'),node.getAttribute('name'),
            row?.dataset.index,row?.dataset.folderId,row?.getAttribute('data-content-key'),
            record?.id,record?.url,
            node!==row && node.matches('button,summary,a,[role="option"]') ? node.textContent.trim().slice(0,300) : ''].join('|');
    }
    function safeImageUrl(value) {
        if (!value) return '';
        if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(value) && value.length < 400000) return value;
        try {
            const url = new URL(value, location.href);
            if (url.origin === location.origin && /^\/[\w/.-]+\.(png|jpe?g|webp|gif|svg)$/i.test(url.pathname)) return url.href;
            if (url.protocol === 'https:' && /^(?:i\d*\.ytimg\.com|img\.youtube\.com|nicovideo\.cdn\.nimg\.jp|tn(?:-smile)?\d*\.smilevideo\.jp|secure-dcdn\.cdn\.nimg\.jp|img\.cdn\.nimg\.jp)$/.test(url.hostname)) return url.href;
        } catch (_) { /* Invalid URLs never leave the PC. */ }
        return '';
    }
    function safeStyle(value) {
        return String(value || '').replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_, quote, url) => {
            const safe = safeImageUrl(url); return safe ? `url("${safe.replace(/"/g,'%22')}")` : 'none';
        }).replace(/@import[^;]*;/gi, '').replace(/expression\([^)]*\)/gi, '');
    }
    function blockedReason(node) {
        if (node.closest('[data-cms-remote-private],#cms-remote-host-panel')) return 'PCで操作してください';
        if (node.matches('input[type=file],input[type=password],a') || pcOnly.has(node.id)) return 'PCで操作してください';
        if (/password|secret|token|api.?key|credential/i.test(node.id + ' ' + node.getAttribute('name'))) return '接続情報はPCで管理します';
        if (node.matches('.cms-rec-danger,.settings-danger-btn') || /削除|初期化/.test(node.textContent.trim()) && node.matches('button')) return '削除・初期化はPCで確認してください';
        if (node.closest('.window-titlebar,.window-resize-handle,.pocket-resize-handle,.bg-position-editing-layer')) return '配置のドラッグ操作はPCで行ってください';
        return '';
    }
    function keyFor(node, kind = 'control') {
        const sig = signature(node), old = nodeKeys.get(node);
        if (old?.signature === sig) return old;
        const entry = { id: `${kind}-${++serial}`, node, signature: sig, firstRevision: revision + 1 };
        nodeKeys.set(node, entry); return entry;
    }
    function sanitizeClone(original, clone, next) {
        if (original.nodeType !== Node.ELEMENT_NODE) return;
        const badTag = /^(SCRIPT|IFRAME|AUDIO|VIDEO|OBJECT|EMBED|TEMPLATE|LINK|META|BASE|FOREIGNOBJECT)$/i.test(original.tagName);
        if (badTag || original.matches('[data-cms-remote-private],#cms-remote-host-panel,#cms-remote-fab')) { clone.remove(); return; }
        for (const attribute of Array.from(clone.attributes)) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on') || /^(src|srcset|href|xlink:href|srcdoc|action|formaction|target|download|contenteditable|autofocus|nonce|integrity)$/.test(name) || name.startsWith('data-') && !/^(data-tab|data-kind|data-site-label|data-queue-offset)$/.test(name)) clone.removeAttribute(attribute.name);
        }
        if (original.hasAttribute('style')) clone.setAttribute('style', safeStyle(original.getAttribute('style')));
        if (/^(cloud-status|cloud-history-status|analysis-export-status)/.test(original.id)) {
            clone.textContent=original.textContent.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'接続済みアカウント').replace(/[A-Z]:\\[^\n\r<>]*/gi,'PCの保存先');
            return;
        }
        if (original.tagName === 'IMG') { const safe = safeImageUrl(original.currentSrc || original.src); if (safe) clone.setAttribute('src', safe); }
        if (original.matches('input,textarea,select')) {
            const blocked = blockedReason(original);
            if (original.tagName === 'TEXTAREA') clone.textContent = blocked ? '' : original.value;
            else if (original.tagName === 'INPUT') clone.setAttribute('value', blocked ? '' : original.value);
            if (original.tagName === 'INPUT') clone.toggleAttribute('checked', original.checked);
            if (original.tagName === 'SELECT') Array.from(clone.options).forEach((option, i) => option.toggleAttribute('selected', original.options[i].selected));
        }
        if (original.tagName === 'DETAILS') clone.toggleAttribute('open', original.open);
        if (original.matches(selector) || original.matches(scrollSelector)) {
            const entry = keyFor(original, original.matches(scrollSelector) ? 'scroll' : 'control');
            next.set(entry.id, entry); clone.setAttribute(CONTROL, entry.id);
            if (original.matches(scrollSelector)) {
                clone.setAttribute('data-cms-remote-scroll', 'true');
                clone.setAttribute('data-cms-remote-scroll-y', String(original.scrollTop / Math.max(1, original.scrollHeight - original.clientHeight)));
            }
            const blocked = blockedReason(original);
            if (blocked) { clone.setAttribute(BLOCKED, blocked); clone.setAttribute('title', blocked); clone.setAttribute('aria-disabled', 'true'); }
        }
        // Convert Font Awesome glyphs without sending a third-party font dependency.
        if (original.tagName === 'I' && /\bfa[srlbd]?\b/.test(original.className)) {
            const glyphs = { 'fa-play':'▶','fa-pause':'Ⅱ','fa-forward-step':'⏭','fa-backward-step':'⏮','fa-lock':'▣','fa-unlock':'▢','fa-cog':'⚙','fa-search':'⌕','fa-filter':'▽','fa-chevron-down':'⌄','fa-plus':'+','fa-folder':'▱','fa-chart-column':'▥','fa-volume-high':'♫','fa-times':'×','fa-check':'✓','fa-list':'☷','fa-cloud':'☁' };
            clone.textContent = Object.entries(glyphs).find(([name]) => original.classList.contains(name))?.[1] || '·';
            clone.style.fontFamily = 'system-ui'; clone.style.fontStyle = 'normal';
        }
        const originals = Array.from(original.children), copies = Array.from(clone.children);
        originals.forEach((child,i) => { if (copies[i]) sanitizeClone(child,copies[i],next); });
    }
    function captureMirror() {
        const next = new Map(), clone = document.body.cloneNode(true);
        sanitizeClone(document.body, clone, next);
        const container = clone.querySelector('#player-container');
        if (container) {
            container.replaceChildren();
            const card = document.createElement('div'); card.className = 'cms-remote-player-preview';
            const art = document.getElementById('widget-art'), safe = safeImageUrl(art?.src);
            if (safe) { const img = document.createElement('img'); img.src = safe; img.alt = ''; card.append(img); }
            const label = document.createElement('span'); label.textContent = '音声・動画はPCで再生しています'; card.append(label); container.append(card);
        }
        controls = next;
        const snapshot = { html: clone.innerHTML, bodyClass: clone.className, bodyStyle: safeStyle(document.body.getAttribute('style')),
            title: 'CMS — PCを遠隔操作', css: Array.from(document.querySelectorAll('link[rel=stylesheet]')).map(link=>new URL(link.href)).filter(url=>url.origin===location.origin).map(url=>url.pathname+url.search),
            styles: Array.from(document.head.querySelectorAll('style')).map(style=>safeStyle(style.textContent)).join('\n').slice(0,150000),
            playback: { title: document.getElementById('widget-title')?.textContent || '未再生', artist: document.getElementById('widget-artist')?.textContent || '' },
            mobile:window.CmsRemoteModel?.snapshot(),
            status: '音声はPCから出ます。スマホはリモコンです。' };
        // Keep the relay's 2 MiB boundary even with large inline artwork/catalogs.
        const bytes=()=>new TextEncoder().encode(JSON.stringify(snapshot)).length;
        if(bytes()>1900000){snapshot.html='<p>旧PC表示はデータ量が多いため省略しました。上部のA1表示をご利用ください。</p>';snapshot.styles='';snapshot.bodyStyle='';}
        while(snapshot.mobile && bytes()>1900000 && (snapshot.mobile.records.length>1 || snapshot.mobile.player.playlist.length>1)) {
            snapshot.mobile.records=snapshot.mobile.records.slice(0,Math.max(1,Math.floor(snapshot.mobile.records.length/2)));
            snapshot.mobile.player.playlist=snapshot.mobile.player.playlist.slice(0,Math.max(1,Math.floor(snapshot.mobile.player.playlist.length/2)));
            snapshot.mobile.truncated=true;
        }
        return snapshot;
    }
    function available(node) {
        if (!node?.isConnected || node.matches(':disabled,[aria-disabled="true"]') || blockedReason(node)) return false;
        if (node.closest('[hidden],.hidden,[inert]')) return false;
        if (node.closest('.tab-content:not(.active)')) return false;
        const closedDetails=node.closest('details:not([open])');
        if(closedDetails && !closedDetails.querySelector(':scope > summary')?.contains(node))return false;
        const dialog = Array.from(document.querySelectorAll('dialog[open]')).at(-1);
        if (dialog && !dialog.contains(node)) return false;
        const pocket = document.getElementById('pocket-overlay');
        if (pocket && !pocket.classList.contains('hidden') && !pocket.contains(node)) return false;
        const overlays = Array.from(document.querySelectorAll('.overlay-screen:not(.hidden)')).filter(el=>!el.closest('[data-cms-remote-private]') && getComputedStyle(el).display !== 'none');
        const top = overlays.sort((a,b)=>(Number(getComputedStyle(b).zIndex)||0)-(Number(getComputedStyle(a).zIndex)||0))[0];
        return !top || top.contains(node);
    }
    async function dispatch(payload, shownRevision) {
        if (!payload || typeof payload !== 'object') throw new Error('操作形式が不正です');
        if (payload.kind==='action') {
            const context=payload.context;
            if (context && ['play','next','previous','seek'].includes(payload.action)) {
                const current=window.CmsWebPlayer?.getRemoteState?.();
                if (!current || (context.queueId || '')!==(current.queueId || '')
                    || (context.queueRevision ?? 0)!==(current.queueRevision ?? 0)
                    || (context.currentQueueItemId || '')!==(current.currentQueueItemId || '')) {
                    const error=new Error('PCの再生キューが変わりました。現在の曲を確認してから操作してください。');error.code='STALE_QUEUE';throw error;
                }
            }
            await window.CmsRemoteModel.dispatch(payload.action,payload.args); return;
        }
        if (payload.kind === 'keydown' && payload.controlId === 'document' && payload.key === 'Escape') {
            const dialog = Array.from(document.querySelectorAll('dialog[open]')).at(-1);
            if (dialog) { const e = new Event('cancel',{cancelable:true}); if (dialog.dispatchEvent(e)) dialog.close(); }
            else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
            return;
        }
        const entry = controls.get(payload.controlId), node = entry?.node;
        const issue=!entry?'CONTROL_RETIRED':!Number.isInteger(shownRevision)?'INVALID_REVISION':shownRevision<entry.firstRevision?'CONTROL_NOT_SHOWN':shownRevision>revision?'FUTURE_REVISION':signature(node)!==entry.signature?'CONTROL_CHANGED':!available(node)?'CONTROL_UNAVAILABLE':'';
        if(issue){const error=new Error('画面が変わりました。最新の画面で操作してください');error.code=issue;throw error;}
        if (payload.kind === 'scroll') {
            if (!node.matches(scrollSelector) || !Number.isFinite(payload.ratioY) || payload.ratioY < 0 || payload.ratioY > 1) throw new Error('スクロール位置が不正です');
            window.markUserTrackScrollHold?.(3000); node.scrollTop = payload.ratioY * Math.max(0,node.scrollHeight-node.clientHeight); node.dispatchEvent(new Event('scroll')); return;
        }
        if (payload.kind === 'click') {
            if (node.matches('input,textarea,select') && !node.matches('input[type=button],input[type=submit]')) throw new Error('入力操作で値を指定してください');
            if (node.matches('.progress-container')) {
                if (!Number.isFinite(payload.ratioX) || payload.ratioX < 0 || payload.ratioX > 1) throw new Error('再生位置が不正です');
                const rect = node.getBoundingClientRect(); node.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+rect.width*payload.ratioX,clientY:rect.top+rect.height/2}));
            } else node.click();
            return;
        }
        if (payload.kind === 'input' || payload.kind === 'change') {
            if (!node.matches('input,textarea,select')) throw new Error('入力欄ではありません');
            if (node.matches('input[type=checkbox],input[type=radio]')) {
                if (typeof payload.checked !== 'boolean') throw new Error('チェック状態が不正です');
                if (node.checked !== payload.checked) node.click();
                return;
            }
            if (typeof payload.value !== 'string' || payload.value.length > 16000) throw new Error('入力値が長すぎるか不正です');
            if(node.tagName==='SELECT' && node.multiple) {
                if(!Array.isArray(payload.selectedValues) || payload.selectedValues.some(value=>typeof value!=='string' || !Array.from(node.options).some(option=>option.value===value && !option.disabled)))throw new Error('選択肢が変わりました');
                Array.from(node.options).forEach(option=>{option.selected=payload.selectedValues.includes(option.value);});
                node.dispatchEvent(new Event(payload.kind,{bubbles:true}));return;
            }
            if (node.tagName === 'SELECT' && !Array.from(node.options).some(option=>option.value === payload.value && !option.disabled)) throw new Error('選択肢が変わりました');
            if (node.matches('input[type=range],input[type=number]')) {
                const number = Number(payload.value), min = node.min === '' ? -Infinity : Number(node.min), max = node.max === '' ? Infinity : Number(node.max);
                if (!Number.isFinite(number) || number < min || number > max) throw new Error('数値が範囲外です');
            }
            if (node.maxLength > 0 && payload.value.length > node.maxLength) throw new Error('入力文字数が上限を超えています');
            node.value = payload.value;
            node.dispatchEvent(new Event(payload.kind,{bubbles:true})); return;
        }
        throw new Error('この操作には対応していません');
    }
    async function post(path, body = {}) {
        const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),12000);
        try {
            const response = await fetch('/remote-api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(hostToken?{Authorization:'Bearer '+hostToken}:{})},body:JSON.stringify({...body,...(hostToken?{hostToken}:{})}),cache:'no-store',signal:controller.signal});
            const data = await response.json().catch(()=>({}));
            if (!response.ok) throw new Error(data.error || 'PC接続サーバーを確認してください');
            return data;
        } finally {clearTimeout(timeout);}
    }
    function schedule() { dirty = true; if (!timer) timer = setTimeout(()=>{timer=0;void publish();},400); }
    async function publish(force = false) {
        if (!hostToken) return;
        if(publishing){dirty=true;await new Promise(resolve=>publicationWaiters.push(resolve));if(force)return publish(true);return;}
        publishing = true; dirty = false;
        const publishingToken=hostToken;
        try {
            const snapshot = captureMirror(), content = JSON.stringify(snapshot);
            if (force || content !== previousSnapshot) {
                const next = revision + 1;
                // The relay may deliver this snapshot and a fast reply before
                // fetch resolves. Commit the local revision before publishing.
                revision = next;
                await post('host/state',{revision:next,snapshot:{...snapshot,revision:next}});
                if(hostToken!==publishingToken)return;
                previousSnapshot = content;
            }
            return true;
        } catch (error) { status(error.message);return false; }
        finally { publishing = false; for(const resolve of publicationWaiters.splice(0))resolve();if (dirty) schedule(); }
    }
    async function consume(stream, onEvent) {
        const reader = stream.getReader(), decoder = new TextDecoder(); let buffer = '';
        while (true) {
            const {done,value} = await reader.read(); if (done) break;
            buffer += decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
            let boundary;
            while ((boundary=buffer.indexOf('\n\n'))>=0) {
                const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
                const event=block.match(/^event: ?(.+)$/m)?.[1] || 'message';
                const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
                if (data) onEvent(event,JSON.parse(data));
            }
            if (buffer.length > 2200000) throw new Error('通信データが上限を超えました');
        }
    }
    function receive(event, data) {
        if (event === 'peers') {
            peers.clear();for(const peer of data.peers || [])peers.set(peer.peerId,peer);renderPeers();void publish(true);
        }
        if (event === 'pending') { peers.set(data.peerId,{...data,status:'pending'}); renderPeers(); }
        if (event === 'approved') { peers.set(data.peerId,{...data,status:'approved'}); renderPeers();void publish(true); }
        if (event === 'revoked' || event === 'disconnected') { if(data.peerId)peers.delete(data.peerId);renderPeers(); }
        if (event === 'command') {
            const receivingToken=hostToken, receivingGeneration=transportGeneration;
            commandChain = commandChain.then(async()=>{
                if(!receivingToken || receivingToken!==hostToken || peers.get(data.peerId)?.status!=='approved')return;
                let result = handled.get(data.peerId+':'+data.commandId);
                if (!result) {
                    if (handled.size >= 2048) { await stop(); return; }
                    try {
                        if(receivingGeneration!==transportGeneration || Number.isFinite(data.expiresAt) && Date.now()>=data.expiresAt) {const error=new Error('接続または操作の有効期限が変わりました。表示を確認してください。');error.code='STALE_COMMAND';throw error;}
                        await dispatch(data.payload,data.revision);result={ok:true};
                    }
                    catch(error) { result={ok:false,error:error.code||'INVALID_OPERATION',message:error.message,code:error.code||'INVALID_OPERATION'}; }
                    handled.set(data.peerId+':'+data.commandId,result);
                }
                // Publish synchronous UI changes before acknowledging them, so
                // search/folder replies cannot leave an actionable old list.
                const published=await publish(true);
                if(hostToken!==receivingToken)return;
                if (!published && result.ok) result={ok:false,error:'STATE_UNCONFIRMED',message:'操作後のPC状態を確認できません。操作を再送せず、表示を更新してください。'};
                await post('host/ack',{peerId:data.peerId,commandId:data.commandId,result}); schedule();
            }).catch(error=>status(error.message));
        }
        if (event === 'closed') void stop(false);
    }
    function status(message) { const target=document.getElementById('cms-remote-status');if(target && target.textContent!==message)target.textContent=message; }
    function showInvite(data) {
        session = {...session,...data};
        const addressSelect=document.getElementById('cms-remote-address');
        if(addressSelect && data.addresses) {
            addressSelect.replaceChildren();
            for(const address of data.addresses){const option=document.createElement('option');option.value=address;const network=data.networks?.find(item=>item.address===address);option.textContent=(network?.name?network.name+' — ':'')+address+(network?.virtual?'（仮想/VPN候補）':'')+(network?.gateway?'（通常の接続先）':'');addressSelect.append(option);}
            addressSelect.value=data.advertiseAddress || data.addresses[0] || '';
            document.getElementById('cms-remote-address-wrap').hidden=data.addresses.length<2;
        }
        const qr=document.getElementById('cms-remote-qr');qr.replaceChildren();
        if (data.qrSvg) {
            const parsed=new DOMParser().parseFromString(data.qrSvg,'image/svg+xml');
            const svg=parsed.documentElement;
            if (svg.localName==='svg' && !svg.querySelector('script,foreignObject,image,use')) { svg.querySelectorAll('*').forEach(node=>Array.from(node.attributes).forEach(attr=>{if(attr.name.startsWith('on')||attr.name.includes('href'))node.removeAttribute(attr.name);}));qr.append(document.importNode(svg,true)); }
        }
        document.getElementById('cms-remote-link').value=data.inviteLink || '';
        document.getElementById('cms-remote-expiry').textContent='QRの有効期限: '+new Date(data.expiresAt).toLocaleTimeString('ja-JP');
        document.getElementById('cms-remote-start').hidden=true;
        document.getElementById('cms-remote-active').hidden=false;
        status(data.lan && data.addresses?.length ? 'QRをスマホで読み取り、このPCで接続を承認してください。' : 'PC内テストです。スマホ接続にはStart-LAN-Remote.cmdで起動してください。');
    }
    async function start() {
        if (hostToken) return;
        const button=document.getElementById('cms-remote-start');button.disabled=true;
        try {
            let preferred=''; try { const info=await fetch('/remote-api/info',{cache:'no-store'}).then(response=>response.json());const saved=localStorage.getItem('cms_remote_address_v1');if(info.addresses?.includes(saved))preferred=saved; }catch(_) {}
            const data=await post('host/open',preferred?{advertiseAddress:preferred}:{}); hostToken=data.hostToken;session=data;handled.clear();nodeKeys=new WeakMap();controls.clear();revision=0;previousSnapshot='';showInvite(data);
            await window.CmsRemoteModel?.refresh();
            observer=new MutationObserver(changes=>{if(changes.some(change=>!change.target.closest?.('[data-cms-remote-private]')))schedule();});
            observer.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});
            document.addEventListener('input',schedule,true);document.addEventListener('change',schedule,true);window.addEventListener('cms-state-change',schedule);
            heartbeat=setInterval(()=>schedule(),1500);await publish(true);
            void connectHostEvents(hostToken);
        } catch(error) { await stop(false);status(error.message+' — 同梱のPC起動スクリプトからCMSを開いてください。'); }
        finally { button.disabled=false; }
    }
    async function connectHostEvents(token) {
        let disconnectedAt=0,delay=500;
        while(hostToken===token && token) {
            const generation=++transportGeneration;
            abort=new AbortController();
            try {
                const response=await fetch('/remote-api/host/events',{headers:{Authorization:'Bearer '+token},signal:abort.signal,cache:'no-store'});
                if(!response.ok || !response.body)throw new Error('PCの通信接続を開けません');
                disconnectedAt=0;delay=500;
                await consume(response.body,(event,data)=>{if(hostToken===token && generation===transportGeneration)receive(event,data);});
                if(hostToken!==token)return;
            } catch(error) {if(hostToken!==token || error.name==='AbortError')return;}
            // Reconnect the same approved session; never reopen/reapprove it or
            // replay commands whose execution outcome is unknown.
            if(!disconnectedAt)disconnectedAt=Date.now();
            if(Date.now()-disconnectedAt>=25000){await stop(false);status('PCとの接続を復旧できません。新しいQRで接続してください。');return;}
            status('PCの操作接続を再接続しています。音楽再生は続きます。');
            await new Promise(resolve=>setTimeout(resolve,delay));delay=Math.min(5000,delay*2);
        }
    }
    async function stop(revoke = true) {
        const oldToken=hostToken;if(!oldToken)return;
        if(revoke)try{await post('host/revoke');}catch(_) { /* Closing the stream also revokes host ownership. */ }
        hostToken='';transportGeneration++;session=null;abort?.abort();abort=null;observer?.disconnect();observer=null;clearTimeout(timer);timer=0;clearInterval(heartbeat);heartbeat=0;
        document.removeEventListener('input',schedule,true);document.removeEventListener('change',schedule,true);window.removeEventListener('cms-state-change',schedule);
        peers.clear();controls.clear();handled.clear();renderPeers();
        document.getElementById('cms-remote-start').hidden=false;document.getElementById('cms-remote-active').hidden=true;document.getElementById('cms-remote-link').value='';document.getElementById('cms-remote-qr').replaceChildren();
        status('遠隔操作を終了しました。PCの音楽再生は続きます。');
    }
    function renderPeers() {
        const list=document.getElementById('cms-remote-peers');if(!list)return;list.replaceChildren();
        for(const peer of peers.values()) {
            const row=document.createElement('div');row.className='cms-remote-peer';
            const label=document.createElement('span');label.textContent=(peer.label||'ブラウザ')+' — '+(peer.status==='pending'?'承認待ち':'接続済み');row.append(label);
            for(const [text,approval] of peer.status==='pending'?[['承認',true],['拒否',false]]:[['解除',false]]) {
                const button=document.createElement('button');button.type='button';button.textContent=text;button.dataset.peerId=peer.peerId;button.dataset.approval=String(approval);
                button.onclick=async()=>{button.disabled=true;if(!approval)peers.delete(peer.peerId);try{await post(peer.status==='pending'?'host/approve':'host/revoke',{peerId:peer.peerId,approve:approval});if(approval)peers.set(peer.peerId,{...peer,status:'approved'});renderPeers();void publish(true);}catch(error){status(error.message);button.disabled=false;}};
                row.append(button);
            }
            list.append(row);
        }
    }
    function mount() {
        const panel=document.createElement('section');panel.id='cms-remote-host-panel';panel.dataset.cmsRemotePrivate='true';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','cms-remote-heading');
        panel.innerHTML='<header><h2 id="cms-remote-heading">スマホをCMSリモコンに</h2><button type="button" id="cms-remote-close" aria-label="接続パネルを閉じる">×</button></header><p>音声はPCで再生し、スマホは同じCMS画面から操作します。信頼できる同じWi-Fiだけで使用してください。</p><p id="cms-remote-status" role="status">PC起動スクリプトで開いたCMSから開始できます。</p><button type="button" id="cms-remote-start">遠隔操作を開始・QRを表示</button><div id="cms-remote-active" hidden><div id="cms-remote-qr" aria-label="接続QRコード"></div><p id="cms-remote-expiry"></p><label>接続URL（QRが使えない場合）<input readonly id="cms-remote-link" aria-label="スマホの接続URL"></label><div class="cms-remote-actions"><button type="button" id="cms-remote-renew">QRを更新</button><button type="button" id="cms-remote-stop">すべて解除して終了</button></div><div id="cms-remote-peers" aria-live="polite"></div></div><small>PCのCMSタブは開いたままにしてください。初回再生はPCで一度押してください。Googleログイン・ファイル・削除・配置ドラッグはPCで操作します。HTTP通信のため、共有Wi-Fi・外部公開では使用しないでください。</small>';
        document.body.append(panel);
        const addressWrap=document.createElement('label');addressWrap.id='cms-remote-address-wrap';addressWrap.hidden=true;addressWrap.textContent='スマホと同じネットワークのPCアドレス';
        const addressSelect=document.createElement('select');addressSelect.id='cms-remote-address';addressSelect.setAttribute('aria-label','接続QRに使うPCのネットワーク');addressWrap.append(addressSelect);
        document.getElementById('cms-remote-active').prepend(addressWrap);
        addressSelect.onchange=async()=>{try{const selected=addressSelect.value;showInvite(await post('host/invite',{advertiseAddress:selected}));localStorage.setItem('cms_remote_address_v1',selected);}catch(error){status(error.message);}};
        const button=document.createElement('button');button.type='button';button.id='btn-cms-remote';button.textContent='▣ リモコン';button.title='スマホからこのPCのCMSを操作';button.dataset.cmsRemotePrivate='true';
        const actions=document.querySelector('.pc-appbar-actions');if(actions)actions.prepend(button);
        else {button.id='cms-remote-fab';document.body.append(button);}
        button.onclick=()=>{panel.hidden=false;};document.getElementById('cms-remote-close').onclick=()=>{panel.hidden=true;};
        document.getElementById('cms-remote-start').onclick=()=>void start();document.getElementById('cms-remote-stop').onclick=()=>void stop();
        document.getElementById('cms-remote-renew').onclick=async()=>{try{showInvite(await post('host/invite',addressSelect.value?{advertiseAddress:addressSelect.value}:{}));}catch(error){status(error.message);}};
        window.addEventListener('pagehide',()=>{abort?.abort();});
    }
    // A narrow adapter test surface: no session tokens, credentials, or executable strings.
    window.CmsRemoteHostTools=Object.freeze({captureMirror,safeImageUrl,safeStyle});
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
