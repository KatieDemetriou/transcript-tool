import os
import uuid
import threading
from flask import Flask, request, jsonify, render_template, send_file
import assemblyai as aai

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 600 * 1024 * 1024  # 600MB

UPLOAD_FOLDER = '/tmp/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

jobs = {}  # in-memory store: job_id -> job dict

aai.settings.api_key = os.environ.get('ASSEMBLYAI_API_KEY', '')


def process_transcription(job_id, file_path):
    try:
        jobs[job_id]['status'] = 'processing'

        config = aai.TranscriptionConfig(
            speaker_labels=True,
            language_detection=True,
            speech_model="universal-2",
        )

        transcriber = aai.Transcriber(config=config)
        transcript = transcriber.transcribe(file_path)

        if transcript.status == aai.TranscriptStatus.error:
            jobs[job_id].update({'status': 'error', 'error': transcript.error})
            return

        utterances = []
        if transcript.utterances:
            for u in transcript.utterances:
                words = []
                if u.words:
                    words = [
                        {'text': w.text, 'start': w.start / 1000.0, 'end': w.end / 1000.0}
                        for w in u.words
                    ]
                utterances.append({
                    'speaker': u.speaker,
                    'text': u.text,
                    'start': u.start / 1000.0,
                    'end': u.end / 1000.0,
                    'words': words,
                })

        jobs[job_id].update({
            'status': 'completed',
            'utterances': utterances,
            'language': getattr(transcript, 'language_code', 'unknown'),
        })

    except Exception as e:
        jobs[job_id].update({'status': 'error', 'error': str(e)})


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    file = request.files['audio']
    if not file.filename:
        return jsonify({'error': 'No file selected'}), 400

    job_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1] or '.audio'
    file_path = os.path.join(UPLOAD_FOLDER, f'{job_id}{ext}')
    file.save(file_path)

    jobs[job_id] = {
        'status': 'queued',
        'filename': file.filename,
        'file_path': file_path,
    }

    thread = threading.Thread(target=process_transcription, args=(job_id, file_path), daemon=True)
    thread.start()

    return jsonify({'job_id': job_id})


@app.route('/status/<job_id>')
def status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify({k: v for k, v in job.items() if k != 'file_path'})


@app.route('/audio/<job_id>')
def serve_audio(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    file_path = job.get('file_path', '')
    if not os.path.exists(file_path):
        return jsonify({'error': 'Audio file not found'}), 404
    return send_file(file_path, conditional=True)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
