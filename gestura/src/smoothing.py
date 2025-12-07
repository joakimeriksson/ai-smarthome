"""Signal smoothing filters for gesture data."""

import numpy as np
from dataclasses import dataclass
import time


class ExponentialMovingAverage:
    """Simple exponential moving average filter."""

    def __init__(self, alpha: float = 0.3):
        """
        Args:
            alpha: Smoothing factor (0-1). Higher = less smoothing.
        """
        self.alpha = alpha
        self.value = None

    def update(self, new_value: float) -> float:
        """Update filter with new value and return smoothed result."""
        if self.value is None:
            self.value = new_value
        else:
            self.value = self.alpha * new_value + (1 - self.alpha) * self.value
        return self.value

    def reset(self):
        """Reset filter state."""
        self.value = None


class OneEuroFilter:
    """
    One Euro Filter for smoothing noisy signals while maintaining responsiveness.

    Reference: https://cristal.univ-lille.fr/~casiez/1euro/
    """

    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.007,
                 d_cutoff: float = 1.0):
        """
        Args:
            min_cutoff: Minimum cutoff frequency (lower = more smoothing)
            beta: Speed coefficient (higher = less lag during fast movements)
            d_cutoff: Cutoff frequency for derivative
        """
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff

        self.x_prev = None
        self.dx_prev = 0.0
        self.t_prev = None

    def _smoothing_factor(self, t_e: float, cutoff: float) -> float:
        """Calculate smoothing factor alpha."""
        r = 2 * np.pi * cutoff * t_e
        return r / (r + 1)

    def _exponential_smoothing(self, a: float, x: float, x_prev: float) -> float:
        """Apply exponential smoothing."""
        return a * x + (1 - a) * x_prev

    def update(self, x: float, t: float = None) -> float:
        """
        Update filter with new value.

        Args:
            x: New value
            t: Timestamp (uses current time if not provided)

        Returns:
            Smoothed value
        """
        if t is None:
            t = time.time()

        if self.x_prev is None:
            self.x_prev = x
            self.t_prev = t
            return x

        # Time delta
        t_e = t - self.t_prev
        if t_e <= 0:
            t_e = 1 / 60  # Assume 60 FPS if no time difference

        # Derivative
        dx = (x - self.x_prev) / t_e

        # Smooth derivative
        a_d = self._smoothing_factor(t_e, self.d_cutoff)
        dx_hat = self._exponential_smoothing(a_d, dx, self.dx_prev)

        # Adaptive cutoff based on speed
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)

        # Smooth value
        a = self._smoothing_factor(t_e, cutoff)
        x_hat = self._exponential_smoothing(a, x, self.x_prev)

        # Store for next iteration
        self.x_prev = x_hat
        self.dx_prev = dx_hat
        self.t_prev = t

        return x_hat

    def reset(self):
        """Reset filter state."""
        self.x_prev = None
        self.dx_prev = 0.0
        self.t_prev = None


class GestureSmoothing:
    """Smoothing for all gesture features."""

    def __init__(self, filter_type: str = "one_euro", **kwargs):
        """
        Args:
            filter_type: "ema" or "one_euro"
            **kwargs: Filter-specific parameters
        """
        self.filter_type = filter_type
        self.kwargs = kwargs
        self.filters = {}

    def _get_filter(self, key: str):
        """Get or create a filter for a specific feature."""
        if key not in self.filters:
            if self.filter_type == "ema":
                self.filters[key] = ExponentialMovingAverage(**self.kwargs)
            else:
                self.filters[key] = OneEuroFilter(**self.kwargs)
        return self.filters[key]

    def smooth(self, features: dict[str, float], t: float = None) -> dict[str, float]:
        """
        Smooth all features.

        Args:
            features: Dict of feature name -> raw value
            t: Timestamp (optional)

        Returns:
            Dict of feature name -> smoothed value
        """
        smoothed = {}
        for key, value in features.items():
            filt = self._get_filter(key)
            if self.filter_type == "one_euro":
                smoothed[key] = filt.update(value, t)
            else:
                smoothed[key] = filt.update(value)
        return smoothed

    def reset(self):
        """Reset all filters."""
        for filt in self.filters.values():
            filt.reset()
        self.filters.clear()
