import os
import logging
from groq import Groq
from dotenv import load_dotenv

# Ensure .env is loaded
load_dotenv()
logger = logging.getLogger("GroqService")

# Active verified Groq models
DEFAULT_CHAT_MODEL = "qwen/qwen3.8-27b"

AVAILABLE_MODELS = [
    {
        "id": "qwen/qwen3.8-27b",
        "name": "Qwen 3.8 27B",
        "description": "Ultra fast, highly capable reasoning & coding model",
        "supports_vision": False,
        "badge": "Recommended"
    },
    {
        "id": "groq/compound-mini",
        "name": "Groq Compound Mini",
        "description": "High throughput instant responses for quick queries",
        "supports_vision": False,
        "badge": "Fastest"
    },
    {
        "id": "groq/compound",
        "name": "Groq Compound",
        "description": "Advanced multi-step reasoning and deep analysis",
        "supports_vision": False,
        "badge": "Deep Reasoning"
    },
    {
        "id": "openai/gpt-oss-120b",
        "name": "GPT OSS 120B",
        "description": "Large parameter model with extensive knowledge base",
        "supports_vision": False,
        "badge": "120B Large"
    },
    {
        "id": "openai/gpt-oss-20b",
        "name": "GPT OSS 20B",
        "description": "Compact and efficient for general everyday tasks",
        "supports_vision": False,
        "badge": "Balanced"
    },
    {
        "id": "allam-2-7b",
        "name": "Allam 2 7B",
        "description": "Bilingual multi-language conversation model",
        "supports_vision": False,
        "badge": "Multilingual"
    }
]

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
            self._client = Groq(api_key=current_key)
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
        """Fetches dynamic model list from Groq API or falls back to AVAILABLE_MODELS."""
        try:
            if not self.is_configured():
                return AVAILABLE_MODELS
            
            client = self.get_client()
            remote_models = client.models.list().data
            remote_ids = {m.id for m in remote_models}
            
            # Filter out non-chat / guard models (whisper, prompt-guard, safeguard)
            chat_models = []
            known_ids = set()
            
            for m in AVAILABLE_MODELS:
                if m["id"] in remote_ids:
                    chat_models.append(m)
                    known_ids.add(m["id"])
                    
            for m in remote_models:
                m_id = m.id
                if m_id not in known_ids and not any(k in m_id.lower() for k in ["whisper", "guard", "audio"]):
                    chat_models.append({
                        "id": m_id,
                        "name": m_id.split("/")[-1].replace("-", " ").title(),
                        "description": "Active Groq Model",
                        "supports_vision": "vision" in m_id.lower(),
                        "badge": "Active"
                    })
                    
            return chat_models if chat_models else AVAILABLE_MODELS
        except Exception as e:
            logger.warning(f"Failed to fetch remote models, using defaults: {e}")
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

    def generate_chat_stream(self, messages, model=DEFAULT_CHAT_MODEL, system_prompt=None, temperature=0.7, max_tokens=4096):
        """Yields streaming chunks of assistant response with fallback."""
        client = self.get_client()
        
        # Validate or fallback model
        valid_model = model if model else DEFAULT_CHAT_MODEL
        
        formatted_messages = self.prepare_messages_for_groq(
            messages, 
            system_prompt=system_prompt, 
            target_model=valid_model
        )
        
        try:
            stream = client.chat.completions.create(
                model=valid_model,
                messages=formatted_messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True
            )
            for chunk in stream:
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    yield delta.content
        except Exception as e:
            # If model failed with 404 or decommissioned, retry with default model
            if valid_model != DEFAULT_CHAT_MODEL and ("404" in str(e) or "model" in str(e).lower()):
                logger.warning(f"Model {valid_model} failed ({e}), falling back to {DEFAULT_CHAT_MODEL}")
                stream = client.chat.completions.create(
                    model=DEFAULT_CHAT_MODEL,
                    messages=formatted_messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=True
                )
                for chunk in stream:
                    delta = chunk.choices[0].delta
                    if delta and delta.content:
                        yield delta.content
            else:
                raise e

    def generate_chat_response(self, messages, model=DEFAULT_CHAT_MODEL, system_prompt=None, temperature=0.7, max_tokens=4096):
        """Returns complete string of assistant response."""
        client = self.get_client()
        valid_model = model if model else DEFAULT_CHAT_MODEL
        
        formatted_messages = self.prepare_messages_for_groq(
            messages, 
            system_prompt=system_prompt, 
            target_model=valid_model
        )
        
        try:
            response = client.chat.completions.create(
                model=valid_model,
                messages=formatted_messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False
            )
            return response.choices[0].message.content
        except Exception as e:
            if valid_model != DEFAULT_CHAT_MODEL and ("404" in str(e) or "model" in str(e).lower()):
                logger.warning(f"Model {valid_model} failed ({e}), falling back to {DEFAULT_CHAT_MODEL}")
                response = client.chat.completions.create(
                    model=DEFAULT_CHAT_MODEL,
                    messages=formatted_messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=False
                )
                return response.choices[0].message.content
            else:
                raise e

# Global service instance
groq_service = GroqService()
