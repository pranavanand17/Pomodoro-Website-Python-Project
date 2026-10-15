// Minimal sidebar AI helper frontend using fetch to /api/ai

(function () {
  function el(html) {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    return div.firstChild;
  }

  // Add sidebar HTML to the page
  const sidebar = el(`
    <div id="ai-sidebar" class="hidden" aria-hidden="true">
      <div class="ai-header">
        <div class="ai-title">Study Assistant</div>
        <button class="ai-close" title="Close">✕</button>
      </div>
      <div class="ai-body" role="log" aria-live="polite"></div>
      <div class="ai-input">
        <textarea placeholder="Ask me about the app, how to add tasks, start a session, or view stats..." aria-label="Message"></textarea>
        <button class="ai-send">Ask</button>
      </div>
    </div>
  `);

  const toggle = el(`<button id="ai-toggle" title="Open assistant">AI</button>`);

  document.body.appendChild(sidebar);
  document.body.appendChild(toggle);

  const body = sidebar.querySelector('.ai-body');
  const closeBtn = sidebar.querySelector('.ai-close');
  const textarea = sidebar.querySelector('textarea');
  const sendBtn = sidebar.querySelector('.ai-send');

  function addMessage(text, who) {
    const msg = document.createElement('div');
    msg.className = 'ai-message ' + (who === 'user' ? 'user' : 'assistant');
    msg.textContent = text;
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
  }

  function setLoading(loading) {
    sendBtn.disabled = loading;
    if (loading) {
      sendBtn.textContent = '...';
    } else {
      sendBtn.textContent = 'Ask';
    }
  }

  function openSidebar() {
    sidebar.classList.remove('hidden');
    sidebar.setAttribute('aria-hidden', 'false');
    textarea.focus();
  }

  function closeSidebar() {
    sidebar.classList.add('hidden');
    sidebar.setAttribute('aria-hidden', 'true');
  }

  toggle.addEventListener('click', openSidebar);
  closeBtn.addEventListener('click', closeSidebar);

  function sendMessage() {
    const message = textarea.value.trim();
    if (!message) return;
    addMessage(message, 'user');
    textarea.value = '';
    setLoading(true);

    fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }).then(async (resp) => {
      const json = await resp.json();
      if (!json || !json.success) {
        addMessage('Sorry, assistant failed to respond.', 'assistant');
      } else {
        addMessage(json.reply || 'No reply.', 'assistant');
      }
    }).catch((err) => {
      console.error('AI request failed', err);
      addMessage('Network error contacting assistant.', 'assistant');
    }).finally(() => {
      setLoading(false);
    });
  }

  sendBtn.addEventListener('click', sendMessage);
  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // small keyboard shortcut: press "?" to toggle
  window.addEventListener('keydown', function (e) {
    if (e.key === '?') {
      if (sidebar.classList.contains('hidden')) openSidebar();
      else closeSidebar();
    }
  });
})();
