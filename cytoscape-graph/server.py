import os
from flask import Flask, jsonify, send_from_directory

app = Flask(__name__)

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def send_static(path):
    return send_from_directory('.', path)

@app.route('/api/images')
def list_images():
    image_dir = 'imgs'
    images = [os.path.join(image_dir, f) for f in os.listdir(image_dir) if os.path.isfile(os.path.join(image_dir, f))]
    return jsonify(images)

if __name__ == '__main__':
    app.run(debug=True)
