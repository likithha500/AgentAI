/**
 * Core Application Controller for Shawn AI Chatbot
 * Manages chat sessions, streaming SSE messages, theme switching, markdown rendering, and UI interactions
 */

class ChatbotApp {
    constructor() {
        this.currentSessionId = null;
        this.currentSessionTitle = 'New Chat';
        this.isStreaming = false;
        this.sessions = [];
        this.apiKeyConfigured = false;
        this.currentTheme = localStorage.getItem('shawn_theme') || 'dark';
        
        this.initTheme();
        this.initMarked();
        this.bindEvents();
        this.initApp();
    }

    /* ==========================================================================
       Theme Management (Light / Dark)
       ========================================================================== */
    initTheme() {
        const savedTheme = localStorage.getItem('shawn_theme') || 'dark';
        this.setTheme(savedTheme, false);
    }

    setTheme(theme, showNotification = true) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('shawn_theme', theme);

        const icon = document.getElementById('theme-toggle-icon');
        if (icon) {
            if (theme === 'light') {
                icon.setAttribute('data-lucide', 'moon');
            } else {
                icon.setAttribute('data-lucide', 'sun');
            }
            if (window.lucide) lucide.createIcons();
        }

        if (showNotification) {
            this.showToast(`Switched to ${theme === 'light' ? 'Light' : 'Dark'} Mode`, 'info');
        }
    }

    toggleTheme() {
        const nextTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(nextTheme, true);
    }

    initMarked() {
        // Configure marked renderer for code blocks with language headers and copy buttons
        if (typeof marked !== 'undefined') {
            const renderer = new marked.Renderer();
            
            renderer.code = function({ text, lang }) {
                const language = lang || 'plaintext';
                const codeId = `code_${Math.random().toString(36).substring(2, 9)}`;
                return `
                    <div class="code-block-container">
                        <div class="code-header">
                            <span>${language}</span>
                            <button class="copy-code-btn" data-code-id="${codeId}">
                                <i data-lucide="copy" style="width: 14px; height: 14px;"></i> Copy
                            </button>
                        </div>
                        <pre><code id="${codeId}" class="language-${language}">${escapeHtml(text)}</code></pre>
                    </div>
                `;
            };

            marked.setOptions({
                renderer: renderer,
                gfm: true,
                breaks: true
            });
        }
    }

    async initApp() {
        // Restore sidebar collapse state on desktop
        const savedCollapsed = localStorage.getItem('shawn_sidebar_collapsed') === 'true';
        if (savedCollapsed && window.innerWidth > 768) {
            document.getElementById('sidebar')?.classList.add('collapsed');
        }

        await this.checkHealth();
        await this.loadSessions();
        
        // Auto-create or open first chat
        if (this.sessions && this.sessions.length > 0) {
            this.loadSession(this.sessions[0].id);
        } else {
            this.createNewChatUI();
        }

        if (window.lucide) lucide.createIcons();
    }

    /* ==========================================================================
       Health & API Key Configuration
       ========================================================================== */
    async checkHealth() {
        try {
            const res = await fetch('/api/health');
            const data = await res.json();
            
            this.apiKeyConfigured = data.has_api_key && data.api_key_valid;
            const badge = document.getElementById('api-status-badge');
            const statusText = document.getElementById('api-status-text');
            const dot = badge ? badge.querySelector('.status-dot') : null;

            if (data.has_api_key && data.api_key_valid) {
                if (statusText) statusText.textContent = 'Shawn API Ready';
                if (dot) dot.className = 'status-dot online';
            } else if (data.has_api_key && !data.api_key_valid) {
                if (statusText) statusText.textContent = 'Invalid API Key';
                if (dot) dot.className = 'status-dot warning';
            } else {
                if (statusText) statusText.textContent = 'Configure API Key';
                if (dot) dot.className = 'status-dot warning';
            }

            // Dynamically populate model selects if models returned
            if (data.models && data.models.length > 0) {
                const modelSelect = document.getElementById('model-select');
                const defaultModelSelect = document.getElementById('default-model-select');

                if (modelSelect) {
                    const currentVal = modelSelect.value;
                    modelSelect.innerHTML = '';
                    data.models.forEach((m) => {
                        const opt = document.createElement('option');
                        opt.value = m.id;
                        opt.textContent = `${m.name} (${m.badge || 'Active'})`;
                        modelSelect.appendChild(opt);
                    });
                    if (currentVal && data.models.some(m => m.id === currentVal)) {
                        modelSelect.value = currentVal;
                    }
                }

                if (defaultModelSelect) {
                    const currentDefault = defaultModelSelect.value;
                    defaultModelSelect.innerHTML = '';
                    data.models.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m.id;
                        opt.textContent = `${m.name} (${m.badge || 'Active'})`;
                        defaultModelSelect.appendChild(opt);
                    });
                    if (currentDefault && data.models.some(m => m.id === currentDefault)) {
                        defaultModelSelect.value = currentDefault;
                    }
                }
            }
        } catch (e) {
            console.error('Health check failed:', e);
        }
    }

    async testAndSaveApiKey(apiKey, isTestOnly = false) {
        const resultEl = document.getElementById('api-test-result');
        if (resultEl) {
            resultEl.className = 'api-test-result';
            resultEl.textContent = 'Validating key with Groq Cloud...';
            resultEl.classList.remove('hidden');
        }

        try {
            const res = await fetch('/api/settings/key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: apiKey })
            });

            const data = await res.json();
            if (data.success) {
                if (resultEl) {
                    resultEl.className = 'api-test-result success';
                    resultEl.textContent = '✓ Groq API Key is valid and saved!';
                }
                this.showToast('API Key configured successfully!', 'success');
                await this.checkHealth();
                if (!isTestOnly) {
                    setTimeout(() => {
                        document.getElementById('settings-modal').classList.add('hidden');
                    }, 800);
                }
            } else {
                if (resultEl) {
                    resultEl.className = 'api-test-result error';
                    resultEl.textContent = `✗ ${data.error || 'Invalid API Key'}`;
                }
                this.showToast(`Error: ${data.error}`, 'error');
            }
        } catch (err) {
            if (resultEl) {
                resultEl.className = 'api-test-result error';
                resultEl.textContent = `✗ Connection error: ${err.message}`;
            }
        }
    }

    /* ==========================================================================
       Session Management
       ========================================================================== */
    async loadSessions(searchQuery = '') {
        const loadingEl = document.getElementById('history-loading');
        const emptyEl = document.getElementById('history-empty');
        const groupsContainer = document.getElementById('history-groups');

        if (loadingEl) loadingEl.classList.remove('hidden');
        if (emptyEl) emptyEl.classList.add('hidden');

        try {
            const url = searchQuery ? `/api/sessions?q=${encodeURIComponent(searchQuery)}` : '/api/sessions';
            const res = await fetch(url);
            const data = await res.json();
            
            this.sessions = data.all || [];
            const grouped = data.grouped || {};

            if (groupsContainer) groupsContainer.innerHTML = '';

            const categories = [
                { key: 'today', title: 'Today' },
                { key: 'yesterday', title: 'Yesterday' },
                { key: 'previous_7_days', title: 'Previous 7 Days' },
                { key: 'older', title: 'Older' }
            ];

            let hasAny = false;

            categories.forEach(cat => {
                const list = grouped[cat.key] || [];
                if (list.length > 0) {
                    hasAny = true;
                    const groupDiv = document.createElement('div');
                    groupDiv.className = 'history-group';
                    
                    const titleDiv = document.createElement('div');
                    titleDiv.className = 'history-group-title';
                    titleDiv.textContent = cat.title;
                    groupDiv.appendChild(titleDiv);

                    list.forEach(sess => {
                        const item = document.createElement('div');
                        item.className = `history-item ${sess.id === this.currentSessionId ? 'active' : ''}`;
                        item.setAttribute('data-session-id', sess.id);

                        item.innerHTML = `
                            <div class="history-item-left">
                                <i data-lucide="message-square" class="history-item-icon"></i>
                                <span class="history-item-title" title="${escapeHtml(sess.title)}">${escapeHtml(sess.title)}</span>
                            </div>
                            <div class="history-item-actions">
                                <button class="history-item-action-btn edit-btn" title="Rename">
                                    <i data-lucide="edit-3"></i>
                                </button>
                                <button class="history-item-action-btn delete delete-btn" title="Delete">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        `;

                        // Select chat
                        item.querySelector('.history-item-left').addEventListener('click', () => {
                            this.loadSession(sess.id);
                            if (window.innerWidth <= 768) {
                                this.closeSidebar();
                            }
                        });

                        // Rename chat
                        item.querySelector('.edit-btn').addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.promptRenameSession(sess.id, sess.title);
                        });

                        // Delete chat
                        item.querySelector('.delete-btn').addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.deleteSession(sess.id);
                        });

                        groupDiv.appendChild(item);
                    });

                    groupsContainer.appendChild(groupDiv);
                }
            });

            if (emptyEl) {
                emptyEl.classList.toggle('hidden', hasAny);
            }

        } catch (e) {
            console.error('Failed to load sessions:', e);
        } finally {
            if (loadingEl) loadingEl.classList.add('hidden');
            if (window.lucide) lucide.createIcons();
        }
    }

    async createNewChatUI() {
        this.currentSessionId = null;
        this.currentSessionTitle = 'New Chat';
        
        this.updateChatHeaderTitle('New Chat');
        this.highlightActiveSession(null);

        // Clear messages and show welcome screen
        const messagesList = document.getElementById('messages-list');
        const welcomeScreen = document.getElementById('welcome-screen');
        if (messagesList) messagesList.innerHTML = '';
        if (welcomeScreen) welcomeScreen.classList.remove('hidden');

        // Clear staged attachments
        if (window.uploadManager) {
            window.uploadManager.clearAttachments();
        }

        const input = document.getElementById('message-input');
        if (input) {
            input.value = '';
            input.focus();
        }
    }

    async loadSession(sessionId) {
        if (this.isStreaming) return;
        
        try {
            const res = await fetch(`/api/sessions/${sessionId}`);
            if (!res.ok) throw new Error('Session not found');
            
            const data = await res.json();
            const session = data.session;
            const messages = data.messages || [];

            this.currentSessionId = session.id;
            this.currentSessionTitle = session.title;
            
            this.updateChatHeaderTitle(session.title);
            this.highlightActiveSession(sessionId);

            // Update model selector if present
            const modelSelect = document.getElementById('model-select');
            if (modelSelect && session.model) {
                modelSelect.value = session.model;
            }

            const welcomeScreen = document.getElementById('welcome-screen');
            const messagesList = document.getElementById('messages-list');

            if (welcomeScreen) welcomeScreen.classList.add('hidden');
            if (messagesList) {
                messagesList.innerHTML = '';
                messages.forEach(msg => {
                    this.appendMessageToUI(msg);
                });
            }

            this.scrollToBottom();

        } catch (e) {
            console.error('Error loading session:', e);
            this.showToast('Failed to load conversation', 'error');
        }
    }

    promptRenameSession(sessionId, currentTitle) {
        this.sessionToRename = sessionId;
        const modal = document.getElementById('rename-modal');
        const input = document.getElementById('rename-chat-input');
        if (modal && input) {
            input.value = currentTitle;
            modal.classList.remove('hidden');
            setTimeout(() => {
                input.focus();
                input.select();
            }, 50);
        }
    }

    async saveRename() {
        if (!this.sessionToRename) return;
        const input = document.getElementById('rename-chat-input');
        const newTitle = input ? input.value.trim() : '';
        if (!newTitle) return;

        const sessionId = this.sessionToRename;
        const modal = document.getElementById('rename-modal');
        if (modal) modal.classList.add('hidden');

        // Optimistic instant UI update
        const item = document.querySelector(`.history-item[data-session-id="${sessionId}"]`);
        if (item) {
            const titleEl = item.querySelector('.history-item-title');
            if (titleEl) {
                titleEl.textContent = newTitle;
                titleEl.title = newTitle;
            }
        }
        if (this.currentSessionId === sessionId) {
            this.updateChatHeaderTitle(newTitle);
            this.currentSessionTitle = newTitle;
        }
        const sessObj = this.sessions.find(s => s.id === sessionId);
        if (sessObj) sessObj.title = newTitle;

        this.showToast('Conversation renamed', 'success');

        // Background API call
        try {
            await fetch(`/api/sessions/${sessionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle })
            });
        } catch (e) {
            console.error('Rename error:', e);
        }
        this.sessionToRename = null;
    }

    async deleteSession(sessionId) {
        // Optimistic instant removal
        const item = document.querySelector(`.history-item[data-session-id="${sessionId}"]`);
        if (item) {
            item.style.opacity = '0';
            item.style.transform = 'translateX(-20px)';
            item.style.transition = 'all 0.2s ease';
            setTimeout(() => {
                const group = item.closest('.history-group');
                item.remove();
                if (group && group.querySelectorAll('.history-item').length === 0) {
                    group.remove();
                }
                const allItems = document.querySelectorAll('.history-item');
                const emptyEl = document.getElementById('history-empty');
                if (emptyEl && allItems.length === 0) {
                    emptyEl.classList.remove('hidden');
                }
            }, 200);
        }

        this.sessions = this.sessions.filter(s => s.id !== sessionId);

        if (this.currentSessionId === sessionId) {
            if (this.sessions.length > 0) {
                this.loadSession(this.sessions[0].id);
            } else {
                this.createNewChatUI();
            }
        }

        this.showToast('Conversation deleted', 'info');

        // Background API call
        try {
            await fetch(`/api/sessions/${sessionId}`, {
                method: 'DELETE'
            });
        } catch (e) {
            console.error('Delete error:', e);
        }
    }

    async clearAllHistory() {
        // Optimistic clear
        const groupsContainer = document.getElementById('history-groups');
        const emptyEl = document.getElementById('history-empty');
        if (groupsContainer) groupsContainer.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        this.sessions = [];
        this.createNewChatUI();
        this.showToast('All chat history cleared', 'info');

        try {
            await fetch('/api/sessions', { method: 'DELETE' });
        } catch (e) {
            console.error('Clear history error:', e);
        }
    }

    highlightActiveSession(sessionId) {
        document.querySelectorAll('.history-item').forEach(item => {
            const isMatch = item.getAttribute('data-session-id') === sessionId;
            item.classList.toggle('active', isMatch);
        });
    }

    updateChatHeaderTitle(title) {
        const titleEl = document.getElementById('current-chat-title');
        if (titleEl) titleEl.textContent = title;
    }

    /* ==========================================================================
       Message Sending & Streaming
       ========================================================================== */
    async sendMessage() {
        if (this.isStreaming) return;

        const input = document.getElementById('message-input');
        const text = input ? input.value.trim() : '';
        const stagedAttachments = window.uploadManager ? window.uploadManager.getStagedAttachments() : [];

        if (!text && stagedAttachments.length === 0) return;

        const model = document.getElementById('model-select').value;
        const systemPrompt = document.getElementById('system-prompt-input')?.value || '';

        // Hide welcome screen
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) welcomeScreen.classList.add('hidden');

        // Optimistically render user message
        const tempUserMsg = {
            id: 'temp_user_' + Date.now(),
            role: 'user',
            content: text,
            attachments: stagedAttachments,
            created_at: new Date().toISOString()
        };
        this.appendMessageToUI(tempUserMsg);

        // Reset inputs
        if (input) {
            input.value = '';
            input.style.height = 'auto';
        }
        if (window.uploadManager) {
            window.uploadManager.clearAttachments();
        }

        // Show typing indicator
        this.setTypingIndicator(true);
        this.scrollToBottom();

        this.isStreaming = true;

        try {
            const payload = {
                session_id: this.currentSessionId,
                message: text,
                attachments: stagedAttachments,
                model: model,
                system_prompt: systemPrompt,
                stream: true
            };

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // If response is json (non-streaming or error)
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const data = await response.json();
                this.setTypingIndicator(false);
                this.isStreaming = false;

                if (data.assistant_message) {
                    this.currentSessionId = data.session_id;
                    this.appendMessageToUI(data.assistant_message);
                    this.loadSessions();
                    
                    if (window.voiceManager && window.voiceManager.autoSpeak) {
                        window.voiceManager.speak(data.assistant_message.content, data.assistant_message.id);
                    }
                } else if (data.content) {
                    this.appendMessageToUI({
                        id: 'error_' + Date.now(),
                        role: 'assistant',
                        content: data.content
                    });
                }
                return;
            }

            // Stream response using SSE reader
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let assistantMessageBubble = null;
            let fullText = '';
            let messageId = null;

            this.setTypingIndicator(false);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunkText = decoder.decode(value, { stream: true });
                const lines = chunkText.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(line.substring(6));

                            if (json.session_id && !this.currentSessionId) {
                                this.currentSessionId = json.session_id;
                                this.loadSessions();
                            }

                            if (json.chunk) {
                                fullText += json.chunk;
                                if (!assistantMessageBubble) {
                                    assistantMessageBubble = this.createAssistantStreamBubble();
                                }
                                this.updateStreamingBubble(assistantMessageBubble, fullText);
                                this.scrollToBottom();
                            }

                            if (json.done) {
                                messageId = json.message_id;
                                if (assistantMessageBubble) {
                                    this.finalizeAssistantBubble(assistantMessageBubble, fullText, messageId);
                                }
                                this.loadSessions();

                                // Auto speak TTS if enabled
                                if (window.voiceManager && window.voiceManager.autoSpeak) {
                                    window.voiceManager.speak(fullText, messageId);
                                }
                            }

                            if (json.error) {
                                this.showToast(`Error: ${json.error}`, 'error');
                            }
                        } catch (err) {
                            // Non-json SSE chunk line
                        }
                    }
                }
            }

        } catch (error) {
            console.error('Chat error:', error);
            this.setTypingIndicator(false);
            this.showToast(`Failed to generate response: ${error.message}`, 'error');
            this.appendMessageToUI({
                id: 'err_' + Date.now(),
                role: 'assistant',
                content: `⚠️ **Connection Error**: ${error.message}`
            });
        } finally {
            this.isStreaming = false;
            this.setTypingIndicator(false);
            this.scrollToBottom();
        }
    }

    /* ==========================================================================
       Message UI Rendering
       ========================================================================== */
    appendMessageToUI(msg) {
        const list = document.getElementById('messages-list');
        if (!list) return;

        const row = document.createElement('div');
        row.className = `message-row ${msg.role}`;
        row.setAttribute('data-msg-id', msg.id);

        let avatarIcon = msg.role === 'user' ? 'user' : 'bot';
        let attachmentsHtml = this.renderMessageAttachments(msg.attachments || []);

        let formattedContent = '';
        if (msg.role === 'user') {
            formattedContent = `<p>${escapeHtml(msg.content)}</p>`;
        } else {
            formattedContent = marked.parse(msg.content || '');
        }

        row.innerHTML = `
            <div class="message-avatar">
                <i data-lucide="${avatarIcon}"></i>
            </div>
            <div class="message-bubble-wrapper">
                ${attachmentsHtml}
                <div class="message-bubble markdown-body">
                    ${formattedContent}
                </div>
                ${msg.role === 'assistant' ? `
                    <div class="message-actions">
                        <button class="msg-action-btn msg-speak-btn" data-msg-id="${msg.id}" title="Read aloud">
                            <i data-lucide="volume-2"></i>
                        </button>
                        <button class="msg-action-btn msg-copy-btn" title="Copy response">
                            <i data-lucide="copy"></i>
                        </button>
                    </div>
                ` : ''}
            </div>
        `;

        // Event listeners for action buttons
        if (msg.role === 'assistant') {
            const speakBtn = row.querySelector('.msg-speak-btn');
            if (speakBtn) {
                speakBtn.addEventListener('click', () => {
                    if (window.voiceManager) {
                        if (window.voiceManager.isSpeaking && window.voiceManager.activeSpeakingMsgId === msg.id) {
                            window.voiceManager.stopSpeaking();
                        } else {
                            window.voiceManager.speak(msg.content, msg.id);
                        }
                    }
                });
            }

            const copyBtn = row.querySelector('.msg-copy-btn');
            if (copyBtn) {
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(msg.content);
                    this.showToast('Copied message to clipboard', 'info');
                });
            }
        }

        list.appendChild(row);

        // Render math & Prism syntax highlighting
        this.postProcessMessageBubble(row);
        if (window.lucide) lucide.createIcons();
    }

    createAssistantStreamBubble() {
        const list = document.getElementById('messages-list');
        const row = document.createElement('div');
        row.className = 'message-row assistant';
        row.innerHTML = `
            <div class="message-avatar">
                <i data-lucide="bot"></i>
            </div>
            <div class="message-bubble-wrapper">
                <div class="message-bubble markdown-body"></div>
                <div class="message-actions">
                    <button class="msg-action-btn msg-speak-btn" title="Read aloud">
                        <i data-lucide="volume-2"></i>
                    </button>
                    <button class="msg-action-btn msg-copy-btn" title="Copy response">
                        <i data-lucide="copy"></i>
                    </button>
                </div>
            </div>
        `;
        list.appendChild(row);
        if (window.lucide) lucide.createIcons();
        return row;
    }

    updateStreamingBubble(row, currentText) {
        const bubble = row.querySelector('.message-bubble');
        if (bubble) {
            bubble.innerHTML = marked.parse(currentText);
        }
    }

    finalizeAssistantBubble(row, fullText, messageId) {
        row.setAttribute('data-msg-id', messageId);
        const bubble = row.querySelector('.message-bubble');
        if (bubble) {
            bubble.innerHTML = marked.parse(fullText);
        }

        const speakBtn = row.querySelector('.msg-speak-btn');
        if (speakBtn) {
            speakBtn.setAttribute('data-msg-id', messageId);
            speakBtn.addEventListener('click', () => {
                if (window.voiceManager) {
                    if (window.voiceManager.isSpeaking && window.voiceManager.activeSpeakingMsgId === messageId) {
                        window.voiceManager.stopSpeaking();
                    } else {
                        window.voiceManager.speak(fullText, messageId);
                    }
                }
            });
        }

        const copyBtn = row.querySelector('.msg-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(fullText);
                this.showToast('Copied message to clipboard', 'info');
            });
        }

        this.postProcessMessageBubble(row);
    }

    renderMessageAttachments(attachments) {
        if (!attachments || attachments.length === 0) return '';

        let html = '<div class="message-attachments">';
        attachments.forEach(att => {
            if (window.uploadManager) {
                window.uploadManager.registerAttachment(att);
            }
            if (att.file_type === 'image') {
                html += `<img src="${att.url || att.base64_data}" class="msg-attachment-img" alt="${escapeHtml(att.original_name)}" onclick="window.uploadManager.openMediaModal('${att.id}')" />`;
            } else if (att.file_type === 'audio') {
                html += `
                    <div style="display:flex; flex-direction:column; gap:4px; width:100%; max-width:320px;">
                        <span style="font-size:0.75rem; color:var(--text-secondary);"><i data-lucide="headphones" style="width:12px;height:12px;display:inline-block;"></i> ${escapeHtml(att.original_name)}</span>
                        <audio controls class="msg-audio-player" src="${att.url}" style="width:100%;"></audio>
                    </div>
                `;
            } else if (att.file_type === 'video') {
                html += `
                    <div style="display:flex; flex-direction:column; gap:4px; max-width:360px;">
                        <span style="font-size:0.75rem; color:var(--text-secondary);"><i data-lucide="video" style="width:12px;height:12px;display:inline-block;"></i> ${escapeHtml(att.original_name)}</span>
                        <video controls class="msg-video-player" src="${att.url}" style="max-width:100%; border-radius:8px;"></video>
                    </div>
                `;
            } else {
                html += `
                    <div class="msg-attachment-item" style="cursor:pointer;" onclick="window.uploadManager.openMediaModal('${att.id}')">
                        <i data-lucide="file-text" style="width:14px;height:14px;color:var(--primary);"></i>
                        <span style="font-weight:600;">${escapeHtml(att.original_name)}</span>
                        <span style="color:var(--text-muted);">(${att.size_formatted})</span>
                    </div>
                `;
            }
        });
        html += '</div>';
        return html;
    }

    postProcessMessageBubble(container) {
        // Prism syntax highlighting
        if (typeof Prism !== 'undefined') {
            container.querySelectorAll('pre code').forEach((block) => {
                Prism.highlightElement(block);
            });
        }

        // KaTeX Math Rendering
        if (typeof renderMathInElement !== 'undefined') {
            renderMathInElement(container, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false }
                ],
                throwOnError: false
            });
        }

        // Copy code buttons
        container.querySelectorAll('.copy-code-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const codeId = btn.getAttribute('data-code-id');
                const codeEl = document.getElementById(codeId);
                if (codeEl) {
                    navigator.clipboard.writeText(codeEl.innerText);
                    btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px;color:#10b981;"></i> Copied!';
                    setTimeout(() => {
                        btn.innerHTML = '<i data-lucide="copy" style="width:14px;height:14px;"></i> Copy';
                        if (window.lucide) lucide.createIcons();
                    }, 2000);
                }
            });
        });
    }

    setTypingIndicator(show) {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) {
            indicator.classList.toggle('hidden', !show);
        }
    }

    scrollToBottom() {
        const container = document.getElementById('messages-container');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    /* ==========================================================================
       Export Chat
       ========================================================================== */
    async exportChat() {
        if (!this.currentSessionId) {
            this.showToast('No active chat to export', 'info');
            return;
        }

        try {
            const res = await fetch(`/api/sessions/${this.currentSessionId}`);
            const data = await res.json();
            const session = data.session;
            const messages = data.messages || [];

            let md = `# Shawn AI Chat: ${session.title}\n*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;

            messages.forEach(m => {
                const roleName = m.role === 'user' ? 'User' : 'Shawn';
                md += `### 💬 ${roleName} (${new Date(m.created_at).toLocaleTimeString()})\n\n`;
                if (m.attachments && m.attachments.length > 0) {
                    md += `*Attachments: ${m.attachments.map(a => a.original_name).join(', ')}*\n\n`;
                }
                md += `${m.content}\n\n---\n\n`;
            });

            const blob = new Blob([md], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_shawn_chat.md`;
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('Conversation exported as Markdown', 'success');
        } catch (e) {
            this.showToast('Export failed', 'error');
        }
    }

    /* ==========================================================================
       Toast & UI Helpers
       ========================================================================== */
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'info';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'alert-triangle';

        toast.innerHTML = `
            <i data-lucide="${icon}" style="width: 16px; height: 16px;"></i>
            <span>${escapeHtml(message)}</span>
        `;

        container.appendChild(toast);
        if (window.lucide) lucide.createIcons();

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (!sidebar) return;

        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            sidebar.classList.remove('open');
            if (backdrop) backdrop.classList.remove('active');
        } else {
            sidebar.classList.add('collapsed');
            localStorage.setItem('shawn_sidebar_collapsed', 'true');
        }
    }

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (!sidebar) return;

        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            sidebar.classList.toggle('open');
            if (backdrop) backdrop.classList.toggle('active', sidebar.classList.contains('open'));
        } else {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('shawn_sidebar_collapsed', sidebar.classList.contains('collapsed'));
        }
    }

    /* ==========================================================================
       Event Binding
       ========================================================================== */
    bindEvents() {
        // Theme Toggle Button
        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', () => this.toggleTheme());
        }

        // Send button & Message input
        const sendBtn = document.getElementById('send-btn');
        const messageInput = document.getElementById('message-input');

        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.sendMessage());
        }

        if (messageInput) {
            // Auto resize textarea
            messageInput.addEventListener('input', () => {
                messageInput.style.height = 'auto';
                messageInput.style.height = `${Math.min(messageInput.scrollHeight, 180)}px`;
            });

            // Enter key to send, Shift+Enter for new line
            messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }

        // New Chat Button
        const newChatBtn = document.getElementById('new-chat-btn');
        if (newChatBtn) {
            newChatBtn.addEventListener('click', () => {
                this.createNewChatUI();
                if (window.innerWidth <= 768) {
                    this.closeSidebar();
                }
            });
        }

        // Sidebar toggle & close
        const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
        if (toggleSidebarBtn) {
            toggleSidebarBtn.addEventListener('click', () => this.toggleSidebar());
        }
        const closeSidebarBtn = document.getElementById('close-sidebar-btn');
        if (closeSidebarBtn) {
            closeSidebarBtn.addEventListener('click', () => this.closeSidebar());
        }
        const sidebarBackdrop = document.getElementById('sidebar-backdrop');
        if (sidebarBackdrop) {
            sidebarBackdrop.addEventListener('click', () => this.closeSidebar());
        }

        // Rename Modal Save
        const saveRenameBtn = document.getElementById('save-rename-btn');
        const renameInput = document.getElementById('rename-chat-input');
        if (saveRenameBtn) {
            saveRenameBtn.addEventListener('click', () => this.saveRename());
        }
        if (renameInput) {
            renameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.saveRename();
                }
            });
        }

        // Search conversations
        const searchInput = document.getElementById('search-input');
        const clearSearchBtn = document.getElementById('clear-search-btn');

        if (searchInput) {
            let debounce = null;
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value;
                if (clearSearchBtn) clearSearchBtn.classList.toggle('hidden', !query);
                clearTimeout(debounce);
                debounce = setTimeout(() => this.loadSessions(query), 300);
            });
        }

        if (clearSearchBtn && searchInput) {
            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = '';
                clearSearchBtn.classList.add('hidden');
                this.loadSessions();
            });
        }

        // Clear all history
        const clearHistoryBtn = document.getElementById('clear-history-btn');
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => this.clearAllHistory());
        }

        // Export Chat
        const exportBtn = document.getElementById('export-chat-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportChat());
        }

        // Prompt Cards Click
        document.querySelectorAll('.prompt-card').forEach(card => {
            card.addEventListener('click', () => {
                const promptText = card.getAttribute('data-prompt');
                if (messageInput) {
                    messageInput.value = promptText;
                    messageInput.focus();
                    messageInput.dispatchEvent(new Event('input'));
                }
            });
        });

        // Double click chat title to rename
        const chatTitleEl = document.getElementById('current-chat-title');
        if (chatTitleEl) {
            chatTitleEl.addEventListener('dblclick', () => {
                if (this.currentSessionId) {
                    this.promptRenameSession(this.currentSessionId, this.currentSessionTitle);
                }
            });
        }

        // Settings Modal
        const openSettingsBtn = document.getElementById('open-settings-btn');
        const apiStatusBadge = document.getElementById('api-status-badge');
        const settingsModal = document.getElementById('settings-modal');

        const openSettings = () => {
            if (settingsModal) settingsModal.classList.remove('hidden');
        };

        if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSettings);
        if (apiStatusBadge) apiStatusBadge.addEventListener('click', openSettings);

        // Close generic modals
        document.querySelectorAll('.close-modal-btn, .modal-backdrop').forEach(el => {
            el.addEventListener('click', () => {
                const modalId = el.getAttribute('data-close') || el.closest('.modal')?.id;
                if (modalId) {
                    const m = document.getElementById(modalId);
                    if (m) m.classList.add('hidden');
                }
            });
        });

        // Toggle API key visibility in settings
        const toggleKeyVisBtn = document.getElementById('toggle-key-visibility');
        const apiKeyInput = document.getElementById('groq-api-key-input');
        if (toggleKeyVisBtn && apiKeyInput) {
            toggleKeyVisBtn.addEventListener('click', () => {
                const isPassword = apiKeyInput.type === 'password';
                apiKeyInput.type = isPassword ? 'text' : 'password';
                toggleKeyVisBtn.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}"></i>`;
                if (window.lucide) lucide.createIcons();
            });
        }

        // Test API Key button in modal
        const testApiKeyBtn = document.getElementById('test-api-key-btn');
        if (testApiKeyBtn && apiKeyInput) {
            testApiKeyBtn.addEventListener('click', () => {
                const key = apiKeyInput.value.trim();
                if (!key) {
                    this.showToast('Please enter an API key to test', 'error');
                    return;
                }
                this.testAndSaveApiKey(key, true);
            });
        }

        // Save Settings button
        const saveSettingsBtn = document.getElementById('save-settings-btn');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => {
                const key = apiKeyInput ? apiKeyInput.value.trim() : '';
                if (key) {
                    this.testAndSaveApiKey(key, false);
                } else {
                    if (settingsModal) settingsModal.classList.add('hidden');
                }
            });
        }
    }
}

// Utility Helper: HTML Escape
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Utility Helper: JSON Escape for HTML attributes
function escapeJsonForAttr(obj) {
    return JSON.stringify(obj).replace(/"/g, '&quot;');
}

// Initialize Application once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ChatbotApp();
});
