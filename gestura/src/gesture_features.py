"""Gesture feature extraction from hand landmarks."""

import numpy as np
from dataclasses import dataclass
from hand_tracker import HandTracker, HandLandmarks


@dataclass
class GestureFeatures:
    """Extracted gesture features, all normalized to 0.0-1.0 range."""
    palm_x: float          # Horizontal position (0=left, 1=right)
    palm_y: float          # Vertical position (0=top, 1=bottom)
    palm_z: float          # Depth (0=close, 1=far)
    hand_openness: float   # 0=fist, 1=fully open
    pinch_amount: float    # 0=pinched, 1=open
    finger_spread: float   # 0=fingers together, 1=spread apart
    wrist_rotation: float  # 0-1 based on hand rotation

    def to_midi(self) -> dict[str, int]:
        """Convert all features to MIDI CC values (0-127)."""
        return {
            'palm_x': int(self.palm_x * 127),
            'palm_y': int((1.0 - self.palm_y) * 127),  # Invert Y (up = high value)
            'palm_z': int(self.palm_z * 127),
            'hand_openness': int(self.hand_openness * 127),
            'pinch_amount': int(self.pinch_amount * 127),
            'finger_spread': int(self.finger_spread * 127),
            'wrist_rotation': int(self.wrist_rotation * 127),
        }


class GestureExtractor:
    """Extract gesture features from hand landmarks."""

    def __init__(self):
        # Calibration values (can be updated via calibration mode)
        self.z_min = -0.15  # Closest hand position
        self.z_max = 0.05   # Farthest hand position

        # Reference distances for normalization
        self.max_hand_span = 0.35  # Max distance palm to fingertip
        self.max_pinch_dist = 0.15  # Max thumb-index distance

    def extract(self, hand: HandLandmarks) -> GestureFeatures:
        """Extract all gesture features from hand landmarks."""
        landmarks = hand.landmarks

        # Palm center (average of palm landmarks)
        palm_x, palm_y, palm_z = self._calculate_palm_center(landmarks)

        # Normalize palm position
        norm_palm_x = np.clip(palm_x, 0.0, 1.0)
        norm_palm_y = np.clip(palm_y, 0.0, 1.0)
        norm_palm_z = np.clip(
            (palm_z - self.z_min) / (self.z_max - self.z_min),
            0.0, 1.0
        )

        # Hand openness
        openness = self._calculate_openness(landmarks)

        # Pinch amount (thumb to index)
        pinch = self._calculate_pinch(landmarks)

        # Finger spread
        spread = self._calculate_finger_spread(landmarks)

        # Wrist rotation
        rotation = self._calculate_wrist_rotation(landmarks)

        return GestureFeatures(
            palm_x=norm_palm_x,
            palm_y=norm_palm_y,
            palm_z=norm_palm_z,
            hand_openness=openness,
            pinch_amount=pinch,
            finger_spread=spread,
            wrist_rotation=rotation
        )

    def _calculate_palm_center(self, landmarks) -> tuple[float, float, float]:
        """Calculate the center of the palm."""
        palm_indices = HandTracker.PALM_LANDMARKS
        x = np.mean([landmarks[i].x for i in palm_indices])
        y = np.mean([landmarks[i].y for i in palm_indices])
        z = np.mean([landmarks[i].z for i in palm_indices])
        return (x, y, z)

    def _calculate_openness(self, landmarks) -> float:
        """Calculate how open the hand is (0=fist, 1=open)."""
        # Average distance from palm center to each fingertip
        palm_x, palm_y, palm_z = self._calculate_palm_center(landmarks)

        distances = []
        for tip_idx in HandTracker.FINGERTIPS:
            tip = landmarks[tip_idx]
            dist = np.sqrt(
                (tip.x - palm_x) ** 2 +
                (tip.y - palm_y) ** 2 +
                (tip.z - palm_z) ** 2
            )
            distances.append(dist)

        avg_distance = np.mean(distances)
        normalized = avg_distance / self.max_hand_span
        return np.clip(normalized, 0.0, 1.0)

    def _calculate_pinch(self, landmarks) -> float:
        """Calculate pinch gesture (thumb to index tip distance)."""
        thumb = landmarks[HandTracker.THUMB_TIP]
        index = landmarks[HandTracker.INDEX_TIP]

        distance = np.sqrt(
            (thumb.x - index.x) ** 2 +
            (thumb.y - index.y) ** 2 +
            (thumb.z - index.z) ** 2
        )

        # Invert so 1 = open, 0 = pinched
        normalized = distance / self.max_pinch_dist
        return np.clip(normalized, 0.0, 1.0)

    def _calculate_finger_spread(self, landmarks) -> float:
        """Calculate how spread apart the fingers are."""
        # Measure angles between adjacent fingers at MCP joints
        mcp_indices = [
            HandTracker.INDEX_MCP,
            HandTracker.MIDDLE_MCP,
            HandTracker.RING_MCP,
            HandTracker.PINKY_MCP
        ]

        tip_indices = [
            HandTracker.INDEX_TIP,
            HandTracker.MIDDLE_TIP,
            HandTracker.RING_TIP,
            HandTracker.PINKY_TIP
        ]

        # Calculate average distance between adjacent fingertips
        distances = []
        for i in range(len(tip_indices) - 1):
            tip1 = landmarks[tip_indices[i]]
            tip2 = landmarks[tip_indices[i + 1]]
            dist = np.sqrt(
                (tip1.x - tip2.x) ** 2 +
                (tip1.y - tip2.y) ** 2
            )
            distances.append(dist)

        avg_spread = np.mean(distances)
        # Normalize (typical spread range is 0.02 to 0.12)
        normalized = (avg_spread - 0.02) / 0.10
        return np.clip(normalized, 0.0, 1.0)

    def _calculate_wrist_rotation(self, landmarks) -> float:
        """Calculate wrist rotation based on hand orientation."""
        # Use the vector from pinky MCP to index MCP
        index_mcp = landmarks[HandTracker.INDEX_MCP]
        pinky_mcp = landmarks[HandTracker.PINKY_MCP]

        # Calculate angle of this vector
        dx = index_mcp.x - pinky_mcp.x
        dy = index_mcp.y - pinky_mcp.y

        angle = np.arctan2(dy, dx)
        # Normalize to 0-1 range (-pi to pi -> 0 to 1)
        normalized = (angle + np.pi) / (2 * np.pi)
        return np.clip(normalized, 0.0, 1.0)
