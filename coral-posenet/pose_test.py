# Copyright 2019 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import os
import numpy as np
from PIL import Image
from PIL import ImageDraw
from pose_engine import PoseEngine
import svgwrite


EDGES = (
    ('nose', 'left eye'),
    ('nose', 'right eye'),
    ('nose', 'left ear'),
    ('nose', 'right ear'),
    ('left ear', 'left eye'),
    ('right ear', 'right eye'),
    ('left eye', 'right eye'),
    ('left shoulder', 'right shoulder'),
    ('left shoulder', 'left elbow'),
    ('left shoulder', 'left hip'),
    ('right shoulder', 'right elbow'),
    ('right shoulder', 'right hip'),
    ('left elbow', 'left wrist'),
    ('right elbow', 'right wrist'),
    ('left hip', 'right hip'),
    ('left hip', 'left knee'),
    ('right hip', 'right knee'),
    ('left knee', 'left ankle'),
    ('right knee', 'right ankle'),
)

def shadow_text(dwg, x, y, text, font_size=16):
    # draw text, half opacity
    dwg.text((10,10), text, fill=(255,255,255,128))


def draw_pose(dwg, pose, src_size, color='yellow', threshold=0.2):
    box_x, box_y, box_w, box_h = (0, 0, src_size[0], src_size[1])
    scale_x, scale_y = src_size[0] / box_w, src_size[1] / box_h
    xys = {}
    for label, keypoint in pose.keypoints.items():
        if keypoint.score < threshold: continue
        # Offset and scale to source coordinate space.
        kp_y = int((keypoint.yx[0] - box_y) * scale_y)
        kp_x = int((keypoint.yx[1] - box_x) * scale_x)

        xys[label] = (kp_x, kp_y)
        dwg.ellipse([(kp_x, kp_y), (kp_x + 5, kp_y + 5)], fill='cyan')

    for a, b in EDGES:
        if a not in xys or b not in xys: continue
        ax, ay = xys[a]
        bx, by = xys[b]
        dwg.line([(ax, ay),(bx, by)], fill=color, width=2)

def render_overlay(pil_image, poses, src_size, inference_time):
        text_line = 'PoseNet: %.1fms Nposes %d' % (
            inference_time, len(poses))
        shadow_text(pil_image, 10, 20, text_line)
        for pose in poses:
            draw_pose(pil_image, pose, src_size)


engine = PoseEngine('models/posenet_mobilenet_v1_075_481_641_quant_decoder_edgetpu.tflite')


def process_poses(pil_image):
    pil_image.resize((641, 481), Image.NEAREST)
    poses, inference_time = engine.DetectPosesInImage(np.uint8(pil_image))
    print('Inference time: %.fms' % inference_time)

    draw = ImageDraw.Draw(pil_image)
    render_overlay(draw, poses, (641, 481), inference_time)
    del draw

    for pose in poses:
        if pose.score < 0.4: continue
        print('\nPose Score: ', pose.score)
        for label, keypoint in pose.keypoints.items():
            print(' %-20s x=%-4d y=%-4d score=%.1f' %
                  (label, keypoint.yx[1], keypoint.yx[0], keypoint.score))
    return poses

if __name__ == "__main__":
    os.system('wget https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/'
              'Hindu_marriage_ceremony_offering.jpg/'
              '640px-Hindu_marriage_ceremony_offering.jpg -O couple.jpg')
    pil_image = Image.open('couple.jpg')
    process_poses(pil_image)
    pil_image.save('img.jpg')
