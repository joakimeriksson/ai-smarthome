import cv2
from ultralytics import YOLO
import numpy as np
import torch
import argparse

def parse_args():
    parser = argparse.ArgumentParser(description='YOLO Object Detection with Camera')
    parser.add_argument('--camera', type=int, default=0,
                      help='Camera index (default: 0)')
    parser.add_argument('--model', type=str, default='yolo11n.pt',
                      help='YOLO model to use (default: yolo11n.pt)')
    parser.add_argument('--conf', type=float, default=0.60,
                      help='Confidence threshold (default: 0.60)')
    parser.add_argument('--track', action='store_true',
                      help='Enable object tracking')
    parser.add_argument('--iou', type=float, default=0.5,
                      help='IOU threshold for tracking (default: 0.5)')
    return parser.parse_args()

def main():
    args = parse_args()
    
    # Check if CUDA is available, otherwise use CPU
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"Using device: {device}")
    print(f"Using camera index: {args.camera}")
    print(f"Using YOLO model: {args.model}")
    print(f"Confidence threshold: {args.conf}")
    print(f"Tracking enabled: {args.track}")
    if args.track:
        print(f"IOU threshold: {args.iou}")

    # Initialize YOLO model
    try:
        model = YOLO(args.model)
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    # Initialize the camera
    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        print(f"Error: Could not open camera {args.camera}")
        return

    print('Camera initialized:', cap.isOpened())
    print('Frame width:', cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    print('Frame height:', cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    while True:
        # Capture frame-by-frame
        ret, frame = cap.read()
        
        if ret:
            try:
                # Run YOLO inference on the frame
                if args.track:
                    results = model.track(frame, conf=args.conf, iou=args.iou, 
                                       show=True, persist=True)
                else:
                    results = model(frame, device=device, conf=args.conf)
                
                # Visualize the results on the frame
                annotated_frame = results[0].plot()
                
                # Display the annotated frame
                cv2.imshow('YOLO Detection', annotated_frame)
            except Exception as e:
                print(f"Error processing frame: {e}")
                cv2.imshow('YOLO Detection', frame)  # Show original frame if error occurs
            
        # Break the loop if 'q' is pressed
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    # Release everything when done
    cap.release()
    cv2.destroyAllWindows()

if __name__ == '__main__':
    main()