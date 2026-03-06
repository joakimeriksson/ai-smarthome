import json
import os
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)

DATA_FILE = os.path.join(os.path.dirname(__file__), 'data.json')

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def send_static(path):
    return send_from_directory('.', path)

@app.route('/api/data')
def get_data():
    with open(DATA_FILE, 'r') as f:
        return jsonify(json.load(f))

@app.route('/api/data', methods=['POST'])
def save_data():
    data = request.get_json()
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return jsonify({'status': 'ok'})

@app.route('/api/images')
def list_images():
    image_dir = 'imgs'
    images = [os.path.join(image_dir, f) for f in os.listdir(image_dir) if os.path.isfile(os.path.join(image_dir, f))]
    return jsonify(images)

if __name__ == '__main__':
    app.run(debug=True)
