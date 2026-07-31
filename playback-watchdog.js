let activeToken = '';
let deadlineTimer = 0;

function cancelDeadline() {
    clearTimeout(deadlineTimer);
    deadlineTimer = 0;
}

self.onmessage = event => {
    const message = event.data || {};
    if (message.type === 'cancel') {
        if (!message.token || message.token === activeToken) {
            activeToken = '';
            cancelDeadline();
        }
        return;
    }
    if (message.type !== 'arm' || !message.token || !Number.isFinite(Number(message.deadline))) return;
    activeToken = String(message.token);
    const token = activeToken;
    cancelDeadline();
    deadlineTimer = setTimeout(() => {
        if (token !== activeToken) return;
        self.postMessage({ type: 'deadline', token, firedAt: Date.now() });
    }, Math.max(100, Number(message.deadline) - Date.now()));
};
