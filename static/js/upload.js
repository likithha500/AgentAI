/**
 * Upload Module for Shawn AI Chatbot
 * Handles Multi-file uploads, Drag & Drop, Clipboard Paste, Staging, and Lightbox Previews
 */

class UploadManager {
    constructor() {
        this.stagedAttachments = [];
        this.attachmentRegistry = new Map(); // Store full attachment objects keyed by ID
        this.isUploading = false;
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.bindEvents());
        } else {
            this.bindEvents();
        }
    }

    bindEvents() {
        const fileInput = document.getElementById('file-input');
        const attachBtn = document.getElementById('attach-btn');
        const dropOverlay = document.getElementById('drop-overlay');
        const clearAllBtn = document.getElementById('clear-all-attachments-btn');

        // Allow keyboard activation (Enter or Space) on attach button label
        if (attachBtn && fileInput) {
            attachBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInput.click();
                }
            });
        }

        // File picker selection
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    this.handleFiles(Array.from(e.target.files));
                    fileInput.value = ''; // Reset input to allow selecting the same file again
                }
            });
        }

        // Clear all staged attachments
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.clearAttachments();
            });
        }

        // Clipboard Paste Support (e.g. Ctrl+V screenshots, copied files)
        window.addEventListener('paste', (e) => {
            const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
            if (!items) return;

            const files = [];
            for (let i = 0; i < items.length; i++) {
                if (items[i].kind === 'file') {
                    const file = items[i].getAsFile();
                    if (file) files.push(file);
                }
            }

            if (files.length > 0) {
                this.handleFiles(files);
            }
        });

        // Drag & Drop on window
        let dragCounter = 0;

        window.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter++;
            if (dropOverlay) dropOverlay.classList.remove('hidden');
        });

        window.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dropOverlay) dropOverlay.classList.remove('hidden');
        });

        window.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter--;
            if (dragCounter <= 0 && dropOverlay) {
                dragCounter = 0;
                dropOverlay.classList.add('hidden');
            }
        });

        window.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter = 0;
            if (dropOverlay) dropOverlay.classList.add('hidden');
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                this.handleFiles(Array.from(e.dataTransfer.files));
            }
        });

        // Close Lightbox Modal
        document.querySelectorAll('.close-media-modal-btn, .media-modal .modal-backdrop').forEach(el => {
            el.addEventListener('click', () => {
                const modal = document.getElementById('media-modal');
                if (modal) modal.classList.add('hidden');
            });
        });
    }

    async handleFiles(files) {
        if (!files || files.length === 0) return;
        this.isUploading = true;

        const attachBtn = document.getElementById('attach-btn');
        if (attachBtn) {
            attachBtn.style.opacity = '0.6';
        }

        if (window.app) {
            window.app.showToast(`Processing ${files.length} file(s)...`, 'info');
        }

        const formData = new FormData();
        files.forEach(file => {
            formData.append('files', file);
        });

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Server error ${response.status}`);
            }

            const data = await response.json();
            if (data.success && data.attachments && data.attachments.length > 0) {
                data.attachments.forEach(att => {
                    this.stagedAttachments.push(att);
                    this.attachmentRegistry.set(att.id, att);
                });

                this.renderStagedTray();
                if (window.app) {
                    window.app.showToast(`Attached ${data.attachments.length} file(s) successfully`, 'success');
                }
            } else {
                throw new Error(data.error || 'Failed to process upload');
            }
        } catch (error) {
            console.error('File upload error:', error);
            if (window.app) {
                window.app.showToast(`Upload error: ${error.message}`, 'error');
            }
        } finally {
            this.isUploading = false;
            if (attachBtn) {
                attachBtn.style.opacity = '1';
            }
        }
    }

    renderStagedTray() {
        const tray = document.getElementById('attachments-tray');
        const list = document.getElementById('attachments-list');
        const countEl = document.getElementById('attachments-count');

        if (!tray || !list) return;

        if (this.stagedAttachments.length === 0) {
            tray.classList.add('hidden');
            list.innerHTML = '';
            if (countEl) countEl.textContent = '0';
            return;
        }

        tray.classList.remove('hidden');
        if (countEl) countEl.textContent = this.stagedAttachments.length;
        list.innerHTML = '';

        this.stagedAttachments.forEach((att, index) => {
            const chip = document.createElement('div');
            chip.className = 'attachment-chip';
            chip.style.cursor = 'pointer';
            
            let iconName = 'file';
            if (att.file_type === 'image') iconName = 'image';
            else if (att.file_type === 'audio') iconName = 'headphones';
            else if (att.file_type === 'video') iconName = 'video';
            else if (att.file_type === 'code') iconName = 'code';
            else if (att.file_type === 'document') iconName = 'file-text';

            chip.innerHTML = `
                <i data-lucide="${iconName}" class="attachment-chip-icon"></i>
                <span class="attachment-chip-name" title="${escapeHtml(att.original_name)}">${escapeHtml(att.original_name)}</span>
                <span style="font-size: 0.72rem; color: var(--text-muted);">(${att.size_formatted})</span>
                <button class="remove-attachment-btn" data-index="${index}" title="Remove file" type="button">
                    <i data-lucide="x"></i>
                </button>
            `;

            chip.querySelector('.remove-attachment-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeAttachment(index);
            });

            // Click chip to preview
            chip.addEventListener('click', () => {
                this.openMediaModal(att);
            });

            list.appendChild(chip);
        });

        if (window.lucide) lucide.createIcons();
    }

    removeAttachment(index) {
        this.stagedAttachments.splice(index, 1);
        this.renderStagedTray();
    }

    clearAttachments() {
        this.stagedAttachments = [];
        this.renderStagedTray();
    }

    getStagedAttachments() {
        return [...this.stagedAttachments];
    }

    registerAttachment(att) {
        if (att && att.id) {
            this.attachmentRegistry.set(att.id, att);
        }
    }

    getAttachment(id) {
        return this.attachmentRegistry.get(id);
    }

    openMediaModal(attOrId) {
        let att = typeof attOrId === 'string' ? this.getAttachment(attOrId) : attOrId;
        if (!att) return;

        const modal = document.getElementById('media-modal');
        const body = document.getElementById('media-preview-body');
        if (!modal || !body) return;

        body.innerHTML = '';

        if (att.file_type === 'image') {
            body.innerHTML = `<img src="${att.url || att.base64_data}" alt="${escapeHtml(att.original_name)}" />`;
        } else if (att.file_type === 'audio') {
            body.innerHTML = `
                <div style="background: var(--bg-card); padding: 1.5rem; border-radius: 12px; border: 1px solid var(--border-color); text-align: center; max-width: 420px; box-shadow: var(--shadow-lg);">
                    <h4 style="margin-bottom: 0.75rem; color: var(--text-primary);">${escapeHtml(att.original_name)}</h4>
                    <audio controls src="${att.url}" style="width: 100%; margin-bottom: 1rem;"></audio>
                    ${att.audio_transcript ? `<p style="font-size: 0.8rem; color: var(--text-secondary); text-align: left; max-height: 150px; overflow-y: auto; background: var(--bg-card-hover); padding: 0.75rem; border-radius: 6px; border: 1px solid var(--border-color);"><b>Transcript:</b><br>${escapeHtml(att.audio_transcript)}</p>` : ''}
                </div>
            `;
        } else if (att.file_type === 'video') {
            body.innerHTML = `
                <div style="background: var(--bg-card); padding: 1rem; border-radius: 12px; border: 1px solid var(--border-color); text-align: center; box-shadow: var(--shadow-lg);">
                    <video controls src="${att.url}" style="max-width: 75vw; max-height: 70vh; border-radius: 8px;"></video>
                    <p style="margin-top: 0.5rem; color: var(--text-primary); font-size: 0.85rem;">${escapeHtml(att.original_name)}</p>
                </div>
            `;
        } else {
            body.innerHTML = `
                <div style="background: var(--bg-card); padding: 1.5rem; border-radius: 12px; border: 1px solid var(--border-color); max-width: 680px; width: 90vw; max-height: 75vh; overflow-y: auto; box-shadow: var(--shadow-lg);">
                    <h4 style="margin-bottom: 0.5rem; color: var(--text-primary);">${escapeHtml(att.original_name)}</h4>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 1rem;">${(att.file_type || 'FILE').toUpperCase()} &bull; ${att.size_formatted || ''}</p>
                    <pre style="font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; color: var(--text-primary); white-space: pre-wrap; background: var(--bg-card-hover); padding: 1rem; border-radius: 8px; border: 1px solid var(--border-color); max-height: 50vh; overflow-y: auto;">${escapeHtml(att.extracted_text || 'No extractable text found')}</pre>
                </div>
            `;
        }

        modal.classList.remove('hidden');
    }
}

// Global utility helper
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Instantiate globally
window.uploadManager = new UploadManager();
