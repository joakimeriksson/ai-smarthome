import json
import os
import tempfile
from flask import Flask, jsonify, request, send_from_directory, abort

app = Flask(__name__)
# Preserve node/edge key order on GET so round-tripped saves stay diff-friendly
# (Flask's jsonify sorts keys by default, which would reorder the whole file).
app.json.sort_keys = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'data.json')

# The static catch-all only serves these asset extensions, and never these
# files — so configs and source stay private even though they live in BASE_DIR.
STATIC_EXTS = {'.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif',
               '.ico', '.json', '.html', '.map', '.woff', '.woff2'}
PRIVATE_FILES = {'orcid_config.json'}


def read_data():
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def atomic_write(data):
    """Write data.json via a temp file + os.replace so a crash mid-write
    can never leave a truncated/corrupt graph on disk."""
    fd, tmp = tempfile.mkstemp(dir=BASE_DIR, prefix='.data-', suffix='.json')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, DATA_FILE)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')


@app.route('/<path:path>')
def send_static(path):
    ext = os.path.splitext(path)[1].lower()
    if os.path.basename(path) in PRIVATE_FILES or ext not in STATIC_EXTS:
        abort(404)
    return send_from_directory(BASE_DIR, path)


@app.route('/api/data')
def get_data():
    return jsonify(read_data())


@app.route('/api/data', methods=['POST'])
def save_data():
    incoming = request.get_json(silent=True)
    if incoming is None:
        abort(400)

    current = read_data()
    current_version = current.get('version', 0)
    # Optimistic concurrency: reject writes based on a stale copy so two
    # editors can't silently clobber each other (last-writer-wins → 409).
    if incoming.get('version', 0) != current_version:
        return jsonify({
            'status': 'conflict',
            'message': 'Graph changed since you loaded it; reload and retry.',
            'currentVersion': current_version,
        }), 409

    incoming['version'] = current_version + 1
    atomic_write(incoming)
    return jsonify({'status': 'ok', 'version': incoming['version']})


@app.route('/api/images')
def list_images():
    image_dir = os.path.join(BASE_DIR, 'imgs')
    images = [os.path.join('imgs', f) for f in os.listdir(image_dir)
              if os.path.isfile(os.path.join(image_dir, f))]
    return jsonify(images)


if __name__ == '__main__':
    # Debug (auto-reload + interactive debugger) is opt-in — never on for a
    # shared deployment. Enable locally with FLASK_DEBUG=1.
    app.run(debug=os.environ.get('FLASK_DEBUG', '0') == '1')
