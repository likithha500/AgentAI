import os
import json
import logging
from flask import Flask, render_template, request, jsonify, Response, send_from_directory, stream_with_context
from dotenv import load_dotenv, set_key

# Load environment variables
dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(dotenv_path)

import database
import file_processor
from groq_service import groq_service, AVAILABLE_MODELS

# Setup Flask application
app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "groq-chatbot-secret-key-2025")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB max upload size
app.config["UPLOAD_FOLDER"] = file_processor.UPLOAD_FOLDER

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ChatbotApp")

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/health")
def health_check():
    is_configured = groq_service.is_configured()
    valid = False
    message = "Not tested"
    if is_configured:
        valid, message = groq_service.validate_api_key()
    return jsonify({
        "status": "online",
        "has_api_key": is_configured,
        "api_key_valid": valid,
        "validation_message": message,
        "models": groq_service.get_active_models()
    })

@app.route("/api/settings/key", methods=["POST"])
def update_api_key():
    data = request.get_json() or {}
    new_key = data.get("api_key", "").strip()
    
    if not new_key:
        return jsonify({"success": False, "error": "API key cannot be empty"}), 400
        
    valid, message = groq_service.validate_api_key(new_key)
    if not valid:
        return jsonify({"success": False, "error": f"Invalid Groq API Key: {message}"}), 400
        
    # Save to .env file
    try:
        set_key(dotenv_path, "GROQ_API_KEY", new_key)
        os.environ["GROQ_API_KEY"] = new_key
        groq_service.api_key = new_key
        groq_service._client = None  # Reset client
        return jsonify({"success": True, "message": "Groq API Key updated and verified successfully!"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ================= SESSIONS / CONVERSATION HISTORY =================

@app.route("/api/sessions", methods=["GET"])
def get_sessions():
    search_query = request.args.get("q", "").strip()
    result = database.list_sessions(search_query if search_query else None)
    return jsonify(result)

@app.route("/api/sessions", methods=["POST"])
def create_new_session():
    data = request.get_json() or {}
    title = data.get("title", "New Chat")
    model = data.get("model", "qwen/qwen3.8-27b")
    system_prompt = data.get("system_prompt", "")
    
    session = database.create_session(title=title, model=model, system_prompt=system_prompt)
    return jsonify({"success": True, "session": session})

@app.route("/api/sessions/<session_id>", methods=["GET"])
def get_session_details(session_id):
    session = database.get_session(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
        
    messages = database.get_messages(session_id)
    return jsonify({
        "session": session,
        "messages": messages
    })

@app.route("/api/sessions/<session_id>", methods=["PUT"])
def update_session(session_id):
    data = request.get_json() or {}
    if "title" in data:
        session = database.update_session_title(session_id, data["title"].strip())
    elif "model" in data:
        session = database.update_session_model(session_id, data["model"].strip())
    else:
        return jsonify({"error": "No valid fields to update"}), 400
        
    return jsonify({"success": True, "session": session})

@app.route("/api/sessions/<session_id>", methods=["DELETE"])
def delete_session_endpoint(session_id):
    database.delete_session(session_id)
    return jsonify({"success": True, "message": "Session deleted"})

@app.route("/api/sessions", methods=["DELETE"])
def clear_all_history():
    database.clear_all_sessions()
    return jsonify({"success": True, "message": "All chat history cleared"})

# ================= FILE UPLOADS & MULTIMODAL =================

@app.route("/api/upload", methods=["POST"])
def upload_files():
    uploaded_files = []
    if request.files:
        for key in request.files:
            uploaded_files.extend(request.files.getlist(key))
            
    if not uploaded_files:
        return jsonify({"success": False, "error": "No files received by server"}), 400
        
    attachments = []
    errors = []
    
    for file_storage in uploaded_files:
        if not file_storage.filename:
            continue
        try:
            att = file_processor.process_uploaded_file(file_storage, groq_service=groq_service)
            attachments.append(att)
        except Exception as e:
            logger.error(f"Error processing file {file_storage.filename}: {e}")
            errors.append(f"{file_storage.filename}: {str(e)}")
            
    if not attachments and errors:
        return jsonify({"success": False, "error": "; ".join(errors)}), 400
        
    return jsonify({
        "success": True,
        "attachments": attachments
    })

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

# ================= VOICE TRANSCRIPTION (WHISPER) =================

@app.route("/api/transcribe", methods=["POST"])
def transcribe_voice():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400
        
    audio_file = request.files["audio"]
    # Save audio temporarily
    temp_filename = f"voice_rec_{os.urandom(8).hex()}.webm"
    temp_path = os.path.join(app.config["UPLOAD_FOLDER"], temp_filename)
    audio_file.save(temp_path)
    
    try:
        if not groq_service.is_configured():
            return jsonify({"error": "Groq API key is not configured"}), 400
            
        transcript = groq_service.transcribe_audio(temp_path)
        return jsonify({"success": True, "transcript": transcript})
    except Exception as e:
        logger.error(f"Voice transcription failed: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        # Clean up temporary audio file if desired, or keep in uploads
        pass

# ================= CHAT COMPLETIONS (STREAMING & NON-STREAMING) =================

@app.route("/api/chat", methods=["POST"])
def chat_endpoint():
    data = request.get_json() or {}
    session_id = data.get("session_id")
    user_message_text = data.get("message", "").strip()
    attachments = data.get("attachments", [])
    model = data.get("model", "qwen/qwen3.8-27b")
    system_prompt = data.get("system_prompt", "")
    stream = data.get("stream", True)
    
    if not session_id:
        # Auto-create session if not provided
        session = database.create_session(model=model, system_prompt=system_prompt)
        session_id = session["id"]
    else:
        session = database.get_session(session_id)
        if not session:
            session = database.create_session(model=model, system_prompt=system_prompt)
            session_id = session["id"]
            
    # Auto-generate title from first message if title is "New Chat"
    if session and session.get("title") == "New Chat" and user_message_text:
        title_candidate = user_message_text[:35].strip()
        if len(user_message_text) > 35:
            title_candidate += "..."
        database.update_session_title(session_id, title_candidate)
        
    # Save user message to database
    user_msg_db = database.add_message(
        session_id=session_id,
        role="user",
        content=user_message_text,
        attachments=attachments
    )
    
    # Check if Groq API is configured
    if not groq_service.is_configured():
        error_msg = "⚠️ **Groq API Key is not configured.**\nPlease add your `GROQ_API_KEY` in the `.env` file or click the Settings icon in the top right to configure it."
        asst_msg_db = database.add_message(session_id, "assistant", error_msg)
        return jsonify({
            "session_id": session_id,
            "user_message": user_msg_db,
            "assistant_message": asst_msg_db,
            "content": error_msg
        })
        
    # Fetch full conversation history from DB
    history_messages = database.get_messages(session_id)
    
    if stream:
        def generate():
            full_response = []
            try:
                for chunk in groq_service.generate_chat_stream(
                    messages=history_messages,
                    model=model,
                    system_prompt=system_prompt
                ):
                    full_response.append(chunk)
                    payload = json.dumps({"chunk": chunk, "session_id": session_id})
                    yield f"data: {payload}\n\n"
                    
                # Save complete response to database
                final_content = "".join(full_response)
                asst_msg_db = database.add_message(session_id, "assistant", final_content)
                done_payload = json.dumps({
                    "done": True,
                    "session_id": session_id,
                    "message_id": asst_msg_db["id"],
                    "content": final_content
                })
                yield f"data: {done_payload}\n\n"
            except Exception as e:
                logger.error(f"Streaming error: {e}")
                err_text = f"\n\n**Error during generation**: {str(e)}"
                asst_msg_db = database.add_message(session_id, "assistant", "".join(full_response) + err_text)
                err_payload = json.dumps({
                    "error": str(e),
                    "done": True,
                    "session_id": session_id
                })
                yield f"data: {err_payload}\n\n"

        return Response(stream_with_context(generate()), mimetype="text/event-stream")
    else:
        try:
            response_content = groq_service.generate_chat_response(
                messages=history_messages,
                model=model,
                system_prompt=system_prompt
            )
            asst_msg_db = database.add_message(session_id, "assistant", response_content)
            return jsonify({
                "session_id": session_id,
                "user_message": user_msg_db,
                "assistant_message": asst_msg_db,
                "content": response_content
            })
        except Exception as e:
            logger.error(f"Chat error: {e}")
            err_msg = f"**Error calling Groq API:** {str(e)}"
            asst_msg_db = database.add_message(session_id, "assistant", err_msg)
            return jsonify({
                "session_id": session_id,
                "user_message": user_msg_db,
                "assistant_message": asst_msg_db,
                "content": err_msg,
                "error": str(e)
            }), 500

if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "True").lower() in ("true", "1")
    print(f"[GROQ CHATBOT] Server running at http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=debug)
