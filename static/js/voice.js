/**
 * Voice Module for Groq AI Chatbot
 * Handles bidirectional voice:
 * 1. Speech-to-Text (STT): Groq Whisper API + Browser Web Speech fallback
 * 2. Text-to-Speech (TTS): Browser SpeechSynthesis with pitch, rate & auto-speak controls
 */

class VoiceManager {
    constructor() {
        // TTS State
        this.synth = window.speechSynthesis;
        this.voices = [];
        this.selectedVoice = null;
        this.autoSpeak = localStorage.getItem('groq_auto_speak') === 'true';
        this.speechRate = parseFloat(localStorage.getItem('groq_speech_rate') || '1.0');
        this.speechPitch = parseFloat(localStorage.getItem('groq_speech_pitch') || '1.0');
        this.currentUtterance = null;
        this.isSpeaking = false;
        this.activeSpeakingMsgId = null;

        // STT (Whisper & WebSpeech) State
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.recordingTimerInterval = null;
        this.recordingSeconds = 0;
        this.webSpeechRecognition = null;
        this.useWhisper = true;

        this.initTTS();
        this.initWebSpeech();
        this.bindEvents();
    }

    /* ==========================================================================
       1. Text-To-Speech (Agent Voice Output)
       ========================================================================== */
    initTTS() {
        if (!this.synth) {
            console.warn("SpeechSynthesis API not supported in this browser.");
            return;
        }

        const populateVoices = () => {
            this.voices = this.synth.getVoices();
            const voiceSelect = document.getElementById('tts-voice-select');
            if (!voiceSelect || this.voices.length === 0) return;

            voiceSelect.innerHTML = '';
            
            // Prioritize English/natural voices
            const savedVoiceName = localStorage.getItem('groq_selected_voice');
            let defaultIndex = 0;

            this.voices.forEach((voice, index) => {
                const option = document.createElement('option');
                option.value = voice.name;
                option.textContent = `${voice.name} (${voice.lang})${voice.default ? ' — Default' : ''}`;
                voiceSelect.appendChild(option);

                if (savedVoiceName && voice.name === savedVoiceName) {
                    defaultIndex = index;
                } else if (!savedVoiceName && (voice.lang.includes('en') || voice.default)) {
                    defaultIndex = index;
                }
            });

            voiceSelect.selectedIndex = defaultIndex;
            this.selectedVoice = this.voices[defaultIndex];
        };

        populateVoices();
        if (this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = populateVoices;
        }

        // Restore settings
        const autoCheckbox = document.getElementById('auto-speak-checkbox');
        if (autoCheckbox) autoCheckbox.checked = this.autoSpeak;
        this.updateTtsToggleBadge();

        const rateSlider = document.getElementById('tts-rate-slider');
        if (rateSlider) rateSlider.value = this.speechRate;
        const rateVal = document.getElementById('rate-val');
        if (rateVal) rateVal.textContent = `${this.speechRate}x`;

        const pitchSlider = document.getElementById('tts-pitch-slider');
        if (pitchSlider) pitchSlider.value = this.speechPitch;
        const pitchVal = document.getElementById('pitch-val');
        if (pitchVal) pitchVal.textContent = `${this.speechPitch}`;
    }

    cleanTextForSpeech(text) {
        // Strip markdown, URLs, and code blocks for clean speech
        let clean = text
            .replace(/```[\s\S]*?```/g, ' [Code block omitted] ')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/!\[.*?\]\(.*?\)/g, '')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/[#*_~`>-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return clean;
    }

    speak(text, messageId = null) {
        if (!this.synth) return;
        this.stopSpeaking();

        const cleanText = this.cleanTextForSpeech(text);
        if (!cleanText) return;

        const utterance = new SpeechSynthesisUtterance(cleanText);
        if (this.selectedVoice) {
            utterance.voice = this.selectedVoice;
        }
        utterance.rate = this.speechRate;
        utterance.pitch = this.speechPitch;

        this.currentUtterance = utterance;
        this.isSpeaking = true;
        this.activeSpeakingMsgId = messageId;

        // Update UI
        this.setSpeakingState(true, messageId);

        utterance.onend = () => {
            this.isSpeaking = false;
            this.activeSpeakingMsgId = null;
            this.setSpeakingState(false);
        };

        utterance.onerror = (e) => {
            console.error('Speech synthesis error:', e);
            this.isSpeaking = false;
            this.activeSpeakingMsgId = null;
            this.setSpeakingState(false);
        };

        this.synth.speak(utterance);
    }

    stopSpeaking() {
        if (this.synth && this.synth.speaking) {
            this.synth.cancel();
        }
        this.isSpeaking = false;
        this.activeSpeakingMsgId = null;
        this.setSpeakingState(false);
    }

    setSpeakingState(isSpeaking, messageId = null) {
        const stopTtsBtn = document.getElementById('stop-tts-btn');
        if (stopTtsBtn) {
            stopTtsBtn.classList.toggle('hidden', !isSpeaking);
        }

        // Update speak buttons on message bubbles
        document.querySelectorAll('.msg-speak-btn').forEach(btn => {
            const btnMsgId = btn.getAttribute('data-msg-id');
            if (isSpeaking && btnMsgId === messageId) {
                btn.classList.add('speaking');
                btn.innerHTML = '<i data-lucide="volume-x"></i>';
            } else {
                btn.classList.remove('speaking');
                btn.innerHTML = '<i data-lucide="volume-2"></i>';
            }
        });
        if (window.lucide) lucide.createIcons();
    }

    toggleAutoSpeak() {
        this.autoSpeak = !this.autoSpeak;
        localStorage.setItem('groq_auto_speak', this.autoSpeak);
        const autoCheckbox = document.getElementById('auto-speak-checkbox');
        if (autoCheckbox) autoCheckbox.checked = this.autoSpeak;
        this.updateTtsToggleBadge();
        
        if (window.app) {
            window.app.showToast(this.autoSpeak ? 'Voice Auto-Read Enabled' : 'Voice Auto-Read Disabled', 'info');
        }
    }

    updateTtsToggleBadge() {
        const pill = document.getElementById('tts-status-pill');
        if (pill) {
            if (this.autoSpeak) {
                pill.textContent = 'ON';
                pill.className = 'toggle-pill on';
            } else {
                pill.textContent = 'OFF';
                pill.className = 'toggle-pill off';
            }
        }
    }

    /* ==========================================================================
       2. Speech-To-Text (User Voice Input)
       ========================================================================== */
    initWebSpeech() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.webSpeechRecognition = new SpeechRecognition();
            this.webSpeechRecognition.continuous = true;
            this.webSpeechRecognition.interimResults = true;
            this.webSpeechRecognition.lang = 'en-US';

            this.webSpeechRecognition.onresult = (event) => {
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    interim += event.results[i][0].transcript;
                }
                const previewEl = document.getElementById('live-speech-preview');
                if (previewEl && interim.trim()) {
                    previewEl.textContent = `"${interim}"`;
                }
            };
        }
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioChunks = [];
            
            // Prefer webm / mp4 formats
            let options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = { mimeType: 'audio/mp4' };
                if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                    options = {};
                }
            }

            this.mediaRecorder = new MediaRecorder(stream, options);
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());
            };

            this.mediaRecorder.start(200); // 200ms slice
            this.isRecording = true;

            // Start live web speech recognition preview if available
            if (this.webSpeechRecognition) {
                try { this.webSpeechRecognition.start(); } catch (e) {}
            }

            // Show recording bar
            this.showRecordingUI(true);
            this.startTimer();

        } catch (err) {
            console.error('Microphone access denied:', err);
            if (window.app) {
                window.app.showToast('Microphone access was denied or not found.', 'error');
            }
        }
    }

    async stopRecording(transcribe = true) {
        if (!this.isRecording || !this.mediaRecorder) return;

        this.isRecording = false;
        this.stopTimer();
        this.showRecordingUI(false);

        if (this.webSpeechRecognition) {
            try { this.webSpeechRecognition.stop(); } catch (e) {}
        }

        return new Promise((resolve) => {
            this.mediaRecorder.onstop = async () => {
                // Stop all tracks
                if (this.mediaRecorder.stream) {
                    this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
                }

                if (!transcribe) {
                    resolve(null);
                    return;
                }

                const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
                const audioBlob = new Blob(this.audioChunks, { type: mimeType });
                
                // Transcribe with Groq Whisper API
                const transcript = await this.sendToWhisperAPI(audioBlob);
                if (transcript && window.app) {
                    const msgInput = document.getElementById('message-input');
                    if (msgInput) {
                        const current = msgInput.value.trim();
                        msgInput.value = current ? `${current} ${transcript}` : transcript;
                        msgInput.focus();
                        // Auto resize textarea
                        msgInput.dispatchEvent(new Event('input'));
                    }
                }
                resolve(transcript);
            };

            this.mediaRecorder.stop();
        });
    }

    cancelRecording() {
        this.stopRecording(false);
    }

    async sendToWhisperAPI(audioBlob) {
        if (window.app) {
            window.app.showToast('Transcribing audio with Groq Whisper...', 'info');
        }

        const formData = new FormData();
        const extension = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
        formData.append('audio', audioBlob, `recording.${extension}`);

        try {
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (data.success && data.transcript) {
                if (window.app) {
                    window.app.showToast('Voice transcribed successfully!', 'success');
                }
                return data.transcript.trim();
            } else {
                throw new Error(data.error || 'Failed to transcribe audio');
            }
        } catch (error) {
            console.error('Whisper transcription error:', error);
            if (window.app) {
                window.app.showToast(`Transcription error: ${error.message}`, 'error');
            }
            return null;
        }
    }

    showRecordingUI(show) {
        const recordingBar = document.getElementById('recording-bar');
        const micBtn = document.getElementById('mic-btn');
        if (recordingBar) {
            recordingBar.classList.toggle('hidden', !show);
        }
        if (micBtn) {
            micBtn.style.color = show ? 'var(--accent-rose)' : '';
        }
        const previewEl = document.getElementById('live-speech-preview');
        if (previewEl) {
            previewEl.textContent = 'Listening... Speak naturally';
        }
    }

    startTimer() {
        this.recordingSeconds = 0;
        const timerEl = document.getElementById('recording-timer');
        if (timerEl) timerEl.textContent = '00:00';

        this.recordingTimerInterval = setInterval(() => {
            this.recordingSeconds++;
            const mins = String(Math.floor(this.recordingSeconds / 60)).padStart(2, '0');
            const secs = String(this.recordingSeconds % 60).padStart(2, '0');
            if (timerEl) timerEl.textContent = `${mins}:${secs}`;
        }, 1000);
    }

    stopTimer() {
        if (this.recordingTimerInterval) {
            clearInterval(this.recordingTimerInterval);
            this.recordingTimerInterval = null;
        }
    }

    /* ==========================================================================
       Event Listeners Binding
       ========================================================================== */
    bindEvents() {
        // Header TTS Auto-Read toggle button
        const ttsToggleBtn = document.getElementById('tts-toggle-btn');
        if (ttsToggleBtn) {
            ttsToggleBtn.addEventListener('click', () => this.toggleAutoSpeak());
        }

        // Voice Settings Modal trigger
        const voiceSettingsBtn = document.getElementById('voice-settings-btn');
        if (voiceSettingsBtn) {
            voiceSettingsBtn.addEventListener('click', () => {
                document.getElementById('voice-settings-modal').classList.remove('hidden');
            });
        }

        // Voice selection change
        const voiceSelect = document.getElementById('tts-voice-select');
        if (voiceSelect) {
            voiceSelect.addEventListener('change', (e) => {
                const voiceName = e.target.value;
                this.selectedVoice = this.voices.find(v => v.name === voiceName);
                localStorage.setItem('groq_selected_voice', voiceName);
            });
        }

        // Speed / Rate slider
        const rateSlider = document.getElementById('tts-rate-slider');
        const rateVal = document.getElementById('rate-val');
        if (rateSlider) {
            rateSlider.addEventListener('input', (e) => {
                this.speechRate = parseFloat(e.target.value);
                if (rateVal) rateVal.textContent = `${this.speechRate}x`;
                localStorage.setItem('groq_speech_rate', this.speechRate);
            });
        }

        // Pitch slider
        const pitchSlider = document.getElementById('tts-pitch-slider');
        const pitchVal = document.getElementById('pitch-val');
        if (pitchSlider) {
            pitchSlider.addEventListener('input', (e) => {
                this.speechPitch = parseFloat(e.target.value);
                if (pitchVal) pitchVal.textContent = `${this.speechPitch}`;
                localStorage.setItem('groq_speech_pitch', this.speechPitch);
            });
        }

        // Auto-speak checkbox
        const autoCheckbox = document.getElementById('auto-speak-checkbox');
        if (autoCheckbox) {
            autoCheckbox.addEventListener('change', (e) => {
                this.autoSpeak = e.target.checked;
                localStorage.setItem('groq_auto_speak', this.autoSpeak);
                this.updateTtsToggleBadge();
            });
        }

        // Preview voice button in modal
        const previewVoiceBtn = document.getElementById('preview-voice-btn');
        if (previewVoiceBtn) {
            previewVoiceBtn.addEventListener('click', () => {
                this.speak("Hello! I am Shawn, your AI assistant. How can I assist you today?");
            });
        }

        // Global stop speaking button
        const stopTtsBtn = document.getElementById('stop-tts-btn');
        if (stopTtsBtn) {
            stopTtsBtn.addEventListener('click', () => this.stopSpeaking());
        }

        // Mic Input Button (STT)
        const micBtn = document.getElementById('mic-btn');
        if (micBtn) {
            micBtn.addEventListener('click', () => {
                if (this.isRecording) {
                    this.stopRecording(true);
                } else {
                    this.startRecording();
                }
            });
        }

        // Done & Cancel recording buttons
        const stopRecBtn = document.getElementById('stop-recording-btn');
        if (stopRecBtn) {
            stopRecBtn.addEventListener('click', () => this.stopRecording(true));
        }
        const cancelRecBtn = document.getElementById('cancel-recording-btn');
        if (cancelRecBtn) {
            cancelRecBtn.addEventListener('click', () => this.cancelRecording());
        }
    }
}

// Instantiate VoiceManager globally
window.voiceManager = new VoiceManager();
