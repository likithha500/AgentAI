import os
import uuid
import logging
import urllib.parse
import mimetypes
import requests
from PIL import Image
from dotenv import load_dotenv

# Ensure environment variables are loaded
load_dotenv()

logger = logging.getLogger("ImageService")

GENERATED_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "generated_images")
os.makedirs(GENERATED_FOLDER, exist_ok=True)


def format_file_size(bytes_size):
    """Format bytes to human readable string."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.1f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.1f} TB"


class ImageService:
    def __init__(self):
        self.output_dir = GENERATED_FOLDER

    def get_provider(self):
        dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        load_dotenv(dotenv_path, override=True)
        return os.getenv("IMAGE_GENERATION_PROVIDER", "pollinations").strip().lower()

    def get_api_key(self):
        dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        load_dotenv(dotenv_path, override=True)
        key = os.getenv("IMAGE_API_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("STABILITY_API_KEY")
        if key:
            key = key.strip().strip("'").strip('"')
        return key if key else None

    def generate_image(self, prompt, width=1024, height=1024, seed=None):
        """
        Generates an image from a prompt, stores it in the local generated_images directory,
        and returns a structured attachment dictionary.
        """
        cleaned_prompt = prompt.strip() if prompt else "A stunning digital artwork"
        provider = self.get_provider()
        api_key = self.get_api_key()

        image_bytes = None
        used_provider = provider

        try:
            if provider == "openai" and api_key:
                image_bytes = self._generate_with_openai(cleaned_prompt, api_key)
                used_provider = "OpenAI DALL-E 3"
            elif provider == "stability" and api_key:
                image_bytes = self._generate_with_stability(cleaned_prompt, api_key, width, height)
                used_provider = "Stability AI"
            else:
                # Default high-performance fallback: Pollinations AI
                image_bytes = self._generate_with_pollinations(cleaned_prompt, width, height, seed)
                used_provider = "Pollinations AI"
        except Exception as e:
            logger.warning(f"Primary image provider '{provider}' failed ({e}). Falling back to Pollinations AI...")
            try:
                image_bytes = self._generate_with_pollinations(cleaned_prompt, width, height, seed)
                used_provider = "Pollinations AI (Fallback)"
            except Exception as fallback_err:
                logger.error(f"Image generation fallback also failed: {fallback_err}")
                raise RuntimeError(f"Failed to generate image: {str(fallback_err)}")

        if not image_bytes:
            raise ValueError("No image data received from image generator.")

        # Save to local generated_images directory
        image_id = uuid.uuid4().hex
        filename = f"{image_id}.png"
        filepath = os.path.join(self.output_dir, filename)

        with open(filepath, "wb") as f:
            f.write(image_bytes)

        file_size = os.path.getsize(filepath)

        # Inspect dimensions
        dimensions_str = f"{width}x{height}"
        try:
            with Image.open(filepath) as img:
                dimensions_str = f"{img.width}x{img.height}"
        except Exception:
            pass

        attachment = {
            "id": image_id,
            "original_name": f"{image_id[:8]}_generated.png",
            "filename": filename,
            "file_path": filepath,
            "url": f"/generated-images/{filename}",
            "file_type": "image",
            "extension": "png",
            "size_bytes": file_size,
            "size_formatted": format_file_size(file_size),
            "mime_type": "image/png",
            "metadata": {
                "prompt": cleaned_prompt,
                "provider": used_provider,
                "dimensions": dimensions_str,
                "generated": True
            }
        }

        return attachment

    def _generate_with_pollinations(self, prompt, width=1024, height=1024, seed=None):
        """Generates image via Pollinations AI API with fast turbo model and multi-tier fallback."""
        encoded_prompt = urllib.parse.quote(prompt[:300])
        seed_param = f"&seed={seed}" if seed else ""

        headers = {
            "User-Agent": "ShawnAI-Agent/1.0 (ImageGenerator)",
            "Accept": "image/webp,image/png,image/jpeg,*/*"
        }

        # Tier 1: Fast Turbo model (1-2s)
        try:
            url_turbo = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={width}&height={height}&nologo=true&enhance=true&model=turbo{seed_param}"
            response = requests.get(url_turbo, headers=headers, timeout=20)
            if response.status_code == 200 and len(response.content) > 1000:
                return response.content
        except Exception as e:
            logger.warning(f"Pollinations turbo model attempt failed: {e}. Trying standard model...")

        # Tier 2: Standard model
        try:
            url_std = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={width}&height={height}&nologo=true{seed_param}"
            response = requests.get(url_std, headers=headers, timeout=25)
            if response.status_code == 200 and len(response.content) > 1000:
                return response.content
        except Exception as e:
            logger.warning(f"Pollinations standard attempt failed: {e}. Trying compact fallback...")

        # Tier 3: Compact 768x768 fallback (highest throughput)
        url_compact = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width=768&height=768&nologo=true"
        response = requests.get(url_compact, headers=headers, timeout=25)
        if response.status_code == 200 and len(response.content) > 1000:
            return response.content

        raise RuntimeError(f"Pollinations API returned status code {response.status_code}")

    def _generate_with_openai(self, prompt, api_key):
        """Generates image via OpenAI DALL-E 3 API."""
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "dall-e-3",
            "prompt": prompt,
            "n": 1,
            "size": "1024x1024",
            "response_format": "b64_json"
        }

        response = requests.post(
            "https://api.openai.com/v1/images/generations",
            headers=headers,
            json=payload,
            timeout=60
        )
        if response.status_code != 200:
            raise RuntimeError(f"OpenAI DALL-E API error ({response.status_code}): {response.text}")

        data = response.json()
        import base64
        b64_data = data["data"][0]["b64_json"]
        return base64.b64decode(b64_data)

    def _generate_with_stability(self, prompt, api_key, width=1024, height=1024):
        """Generates image via Stability AI REST API."""
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "image/png"
        }
        payload = {
            "prompt": prompt,
            "output_format": "png",
            "aspect_ratio": "1:1"
        }

        response = requests.post(
            "https://api.stability.ai/v2beta/stable-image/generate/core",
            headers=headers,
            files={"none": ""},
            data=payload,
            timeout=60
        )
        if response.status_code != 200:
            raise RuntimeError(f"Stability AI API error ({response.status_code}): {response.text}")

        return response.content


# Global service instance
image_service = ImageService()
