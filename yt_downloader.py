import sys
import json
import os
import uuid
import tempfile
from yt_dlp import YoutubeDL

query = " ".join(sys.argv[1:]).strip()
if not query:
    print(json.dumps({"error": "no query"}))
    sys.exit(1)

if "youtube.com" in query or "youtu.be" in query:
    url = query
else:
    url = f"ytsearch1:{query}"

out_dir = tempfile.gettempdir()
filename = f"yt_{uuid.uuid4().hex}.%(ext)s"
output = os.path.join(out_dir, filename)

ydl_opts = {
    "format": "bestaudio/best",
    "outtmpl": output,
    "quiet": True,
    "noplaylist": True,
    "postprocessors": [{
        "key": "FFmpegExtractAudio",
        "preferredcodec": "mp3",
        "preferredquality": "192",
    }]
}

with YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=True)
    if isinstance(info, dict) and info.get('entries'):
        info = info['entries'][0]
    path = ydl.prepare_filename(info)

print(json.dumps({"path": path, "title": info.get("title", "")}))
