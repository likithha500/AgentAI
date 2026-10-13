import os
import logging
from groq import Groq
from dotenv import load_dotenv

# Ensure .env is loaded
load_dotenv()
logger = logging.getLogger("GroqService")

# Active verified Groq models
DEFAULT_CHAT_MODEL = "openai/gpt-oss-120b"

AVAILABLE_MODELS = [
    {
        "id": "openai/gpt-oss-120b",
        "name": "GPT OSS 120B",
        "description": "Large-parameter model with broad knowledge and strong reasoning",
        "supports_vision": False,
        "badge": "Default",
        "max_tokens": 1000
    },
    {
        "id": "llama-3.3-70b-versatile",
        "name": "Llama 3.3 70B",
        "description": "Meta's latest 70B model — versatile, fast, and highly capable",
        "supports_vision": False,
        "badge": "Recommended",
        "max_tokens": 4096
    },
    {
        "id": "openai/gpt-oss-20b",
        "name": "GPT OSS 20B",
        "description": "Compact and efficient for general everyday tasks",
        "supports_vision": False,
        "badge": "Balanced",
        "max_tokens": 2048
    },
    {
        "id": "llama-3.1-8b-instant",
        "name": "Llama 3.1 8B Instant",
        "description": "Ultra-low-latency 8B model for instant responses",
        "supports_vision": False,
        "badge": "Fastest",
        "max_tokens": 4096
    },
    {
        "id": "qwen/qwen3.8-27b",
        "name": "Qwen 3.8 27B (preview)",
        "description": "Experimental reasoning and coding model — preview quality",
        "supports_vision": False,
        "badge": "Preview",
        "max_tokens": 750
    }
]

FALLBACK_MODELS = [
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant"
]


def get_safe_max_tokens(model_name, requested_max=None):
    """
    Returns safe max_tokens to strictly prevent Groq 429 OTPM
    (Output Tokens Per Minute) rate limit exceeded errors on free tiers.
    """
    if not model_name:
        return 800
    model_lower = str(model_name).lower()
    
    # Qwen models on free tier enforce a tight 1000 OTPM limit
    if "qwen" in model_lower:
        return min(requested_max or 750, 750)
    elif "120b" in model_lower:
        return min(requested_max or 1000, 1000)
    elif "70b" in model_lower:
        # llama-3.3-70b-versatile: 32 768 token context, up to 32 768 output
        return min(requested_max or 4096, 4096)
    elif "8b" in model_lower:
        # llama-3.1-8b-instant: generous throughput on free tier
        return min(requested_max or 4096, 4096)
    else:
        return min(requested_max or 2048, 2048)


class GroqService:
    def __init__(self, api_key=None):
        self.api_key = api_key
        self._client = None
        
    def get_api_key(self):
        dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        load_dotenv(dotenv_path, override=True)
        key = self.api_key or os.getenv("GROQ_API_KEY")
        if key:
            key = key.strip().strip("'").strip('"')
        return key if key else None

    def get_client(self):
        current_key = self.get_api_key()
        if not current_key or current_key == "your_groq_api_key_here":
            raise ValueError("GROQ_API_KEY is not set. Please add your Groq API key to .env file.")
        
        if self._client is None or self.api_key != current_key:
            self.api_key = current_key
            self._client = Groq(api_key=current_key, max_retries=0)
        return self._client

    def is_configured(self):
        key = self.get_api_key()
        return bool(key and key != "your_groq_api_key_here")

    def validate_api_key(self, api_key_to_test=None):
        try:
            test_key = api_key_to_test or self.get_api_key()
            if test_key:
                test_key = test_key.strip().strip("'").strip('"')
            if not test_key:
                return False, "API key is missing"
            client = Groq(api_key=test_key)
            client.models.list()
            return True, "API key is valid"
        except Exception as e:
            return False, str(e)

    def get_active_models(self):
        """Returns the list of available models."""
        return AVAILABLE_MODELS

    def transcribe_audio(self, audio_file_path, language=None):
        """Transcribe an audio file using Groq Whisper."""
        client = self.get_client()
        with open(audio_file_path, "rb") as file_obj:
            transcription = client.audio.transcriptions.create(
                file=(os.path.basename(audio_file_path), file_obj.read()),
                model="whisper-large-v3-turbo",
                response_format="json",
                language=language,
                temperature=0.0
            )
        return transcription.text

    def classify_and_route_intent(self, user_message, conversation_history=None, attachments=None):
        """
        Analyzes the user's request to determine if it requires TEXT, IMAGE, or BOTH.
        Uses fast heuristic pre-checks and lightweight classifier models
        to avoid exhausting main chat model token quotas.
        """
        if not user_message or not user_message.strip():
            return {"action": "TEXT", "image_prompt": "", "reasoning": "Empty message"}

        cleaned = user_message.strip()
        lower_msg = cleaned.lower()

        # 1. Fast Heuristic Checks (instant, 0 tokens consumed)
        has_text_intent = any(k in lower_msg for k in [
            "explain", "what is", "tell me", "how does", "summarize", "guide", 
            "article", "write a story", "overview", "describe how", "breakdown", "why does"
        ])
        has_image_intent = any(k in lower_msg for k in [
            "poster", "infographic", "image", "diagram", "illustration", 
            "picture", "artwork", "wallpaper", "draw ", "draw me", "visualize", "render "
        ])

        if has_text_intent and has_image_intent:
            return {
                "action": "BOTH",
                "image_prompt": cleaned,
                "reasoning": "Heuristic match for BOTH text and image"
            }

        pure_image_starters = [
            "create a poster", "make a poster", "generate an image", "create an image",
            "draw an image", "make an image", "draw a ", "draw me ", "generate a picture",
            "create artwork", "make a wallpaper", "design a poster"
        ]
        if any(lower_msg.startswith(prefix) for prefix in pure_image_starters) or (has_image_intent and not has_text_intent and len(cleaned.split()) <= 15):
            return {
                "action": "IMAGE",
                "image_prompt": cleaned,
                "reasoning": "Heuristic match for pure IMAGE request"
            }

        if not self.is_configured():
            return {"action": "TEXT", "image_prompt": "", "reasoning": "Groq not configured"}

        # 2. Lightweight LLM Intent Classification with fallback
        client = self.get_client()
        classification_models = ["llama-3.1-8b-instant", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"]

        context_snippets = []
        if conversation_history:
            for m in conversation_history[-3:]:
                role = m.get("role", "user")
                content = (m.get("content") or "")[:150]
                if content:
                    context_snippets.append(f"{role.upper()}: {content}")
        context_str = "\n".join(context_snippets) if context_snippets else "None"

        classification_prompt = (
            "You are an intent router. Classify the user request into exactly one action:\n"
            "- 'TEXT': question, explanation, coding, conversation, summary\n"
            "- 'IMAGE': standalone request to generate/draw a picture, poster, wallpaper, or artwork\n"
            "- 'BOTH': requests BOTH a full textual guide/explanation AND an accompanying image/infographic\n\n"
            "Output valid JSON ONLY with NO other text:\n"
            '{"action": "TEXT"|"IMAGE"|"BOTH", "image_prompt": "enhanced visual description if IMAGE or BOTH, else empty"}'
        )

        for c_model in classification_models:
            try:
                response = client.chat.completions.create(
                    model=c_model,
                    messages=[
                        {"role": "system", "content": classification_prompt},
                        {"role": "user", "content": f"Context: {context_str}\nUser Request: {cleaned}"}
                    ],
                    temperature=0.0,
                    max_tokens=200,
                    response_format={"type": "json_object"}
                )
                raw_json = response.choices[0].message.content.strip()
                import json
                result = json.loads(raw_json)
                action = result.get("action", "TEXT").upper()
                if action not in ("TEXT", "IMAGE", "BOTH"):
                    action = "TEXT"
                image_prompt = result.get("image_prompt", "").strip() if action in ("IMAGE", "BOTH") else ""
                if action in ("IMAGE", "BOTH") and not image_prompt:
                    image_prompt = cleaned
                return {
                    "action": action,
                    "image_prompt": image_prompt,
                    "reasoning": f"Routed via {c_model}"
                }
            except Exception as e:
                logger.warning(f"Classifier model {c_model} skipped: {e}")
                continue

        return {"action": "TEXT", "image_prompt": "", "reasoning": "Fallback default"}

    def prepare_messages_for_groq(self, raw_messages, system_prompt=None, target_model=DEFAULT_CHAT_MODEL):
        """
        Transforms internal message format into Groq API format,
        supporting document contexts and media descriptions.
        """
        groq_messages = []
        
        # System prompt
        default_system = (
            "You are Shawn, a brilliant, helpful, articulate, and friendly AI assistant. "
            "You can analyze text, audio transcripts, documents (PDF, DOCX, CSV), and code. "
            "Respond in clean, well-structured GitHub Markdown with formatting, bullet points, and syntax highlighted code blocks when appropriate. "
            "Be direct, polite, concise yet thorough, and voice-friendly."
        )
        sys_content = system_prompt.strip() if system_prompt and system_prompt.strip() else default_system
        groq_messages.append({"role": "system", "content": sys_content})
        
        for msg in raw_messages:
            role = msg.get("role", "user")
            text_content = msg.get("content", "")
            attachments = msg.get("attachments") or []
            
            # Context attachments (extracted text from PDFs, docs, audio transcripts)
            doc_context_parts = []
            
            for att in attachments:
                file_type = att.get("file_type")
                orig_name = att.get("original_name", "file")
                extracted = att.get("extracted_text") or ""
                transcript = att.get("audio_transcript") or ""
                
                if transcript:
                    doc_context_parts.append(f"\n[Attached Audio/Video: {orig_name}]\n{transcript}")
                elif extracted:
                    doc_context_parts.append(f"\n[Attached Document: {orig_name}]\n{extracted}")
                elif file_type == "image":
                    dimensions = att.get("metadata", {}).get("dimensions", "Unknown")
                    doc_context_parts.append(f"\n[Attached Image: {orig_name} ({dimensions}, {att.get('size_formatted', '')})]")
            
            # Combine text and document contexts
            combined_text = text_content
            if doc_context_parts:
                combined_text = "\n".join(doc_context_parts) + "\n\n" + (text_content if text_content else "Please analyze the attached files.")
                
            groq_messages.append({"role": role, "content": combined_text if combined_text.strip() else "(Empty message)"})
                
        return groq_messages

    def generate_chat_stream(self, messages, model=DEFAULT_CHAT_MODEL, system_prompt=None, temperature=0.7, max_tokens=None):
        """Yields streaming chunks of assistant response with automatic OTPM and 429 rate limit fallback."""
        client = self.get_client()
        valid_model = model if model else DEFAULT_CHAT_MODEL
        
        models_to_try = [valid_model]
        for m in FALLBACK_MODELS:
            if m not in models_to_try:
                models_to_try.append(m)

        last_error = None
        for attempt_model in models_to_try:
            safe_tokens = get_safe_max_tokens(attempt_model, max_tokens)
            formatted_messages = self.prepare_messages_for_groq(
                messages, 
                system_prompt=system_prompt, 
                target_model=attempt_model
            )
            
            try:
                stream = client.chat.completions.create(
                    model=attempt_model,
                    messages=formatted_messages,
                    temperature=temperature,
                    max_tokens=safe_tokens,
                    stream=True
                )
                for chunk in stream:
                    delta = chunk.choices[0].delta
                    if delta and delta.content:
                        yield delta.content
                return
            except Exception as e:
                err_str = str(e).lower()
                last_error = e
                logger.warning(f"Model '{attempt_model}' failed with error: {e}. Trying fallback model...")
                if "429" in err_str or "rate_limit" in err_str or "otpm" in err_str or "404" in err_str or "token" in err_str or "limit" in err_str:
                    continue
                else:
                    raise e
                    
        if last_error:
            raise last_error

    def generate_chat_response(self, messages, model=DEFAULT_CHAT_MODEL, system_prompt=None, temperature=0.7, max_tokens=None):
        """Returns complete string of assistant response with automatic OTPM and 429 rate limit fallback."""
        client = self.get_client()
        valid_model = model if model else DEFAULT_CHAT_MODEL
        
        models_to_try = [valid_model]
        for m in FALLBACK_MODELS:
            if m not in models_to_try:
                models_to_try.append(m)

        last_error = None
        for attempt_model in models_to_try:
            safe_tokens = get_safe_max_tokens(attempt_model, max_tokens)
            formatted_messages = self.prepare_messages_for_groq(
                messages, 
                system_prompt=system_prompt, 
                target_model=attempt_model
            )
            
            try:
                response = client.chat.completions.create(
                    model=attempt_model,
                    messages=formatted_messages,
                    temperature=temperature,
                    max_tokens=safe_tokens,
                    stream=False
                )
                return response.choices[0].message.content
            except Exception as e:
                err_str = str(e).lower()
                last_error = e
                logger.warning(f"Model '{attempt_model}' failed with error: {e}. Trying fallback model...")
                if "429" in err_str or "rate_limit" in err_str or "otpm" in err_str or "404" in err_str or "token" in err_str or "limit" in err_str:
                    continue
                else:
                    raise e
                    
        if last_error:
            raise last_error


# Global service instance
groq_service = GroqService()
