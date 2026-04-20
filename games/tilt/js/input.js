// Input handler: gyroscope + keyboard fallback
// iOS13+: requestPermission() must be called synchronously from a user gesture

class InputHandler {
    constructor() {
        this.beta  = 0;   // raw device beta
        this.gamma = 0;   // raw device gamma
        this.baseBeta  = 0;   // calibration reference
        this.baseGamma = 0;
        // Settings (loaded from localStorage)
        this.sensitivity = parseFloat(localStorage.getItem('tilt_sens') || '1.0');
        this.maxSpeed    = parseFloat(localStorage.getItem('tilt_maxspd') || '10');
        this._keys = {};
        this._gyroActive = false;
        this._wakeLock   = null;
        this._bindKeys();
    }

    _bindKeys() {
        window.addEventListener('keydown', e => {
            this._keys[e.code] = true;
            if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
        });
        window.addEventListener('keyup', e => { this._keys[e.code] = false; });
    }

    // Must be called DIRECTLY from a button click (no preceding await)
    requestGyroPermission(onGranted, onDenied) {
        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS 13+
            DeviceOrientationEvent.requestPermission()
                .then(state => {
                    if (state === 'granted') {
                        this._attachGyro();
                        this._requestWakeLock();
                        onGranted && onGranted();
                    } else {
                        onDenied && onDenied();
                    }
                })
                .catch(() => onDenied && onDenied());
        } else {
            // Android / desktop
            this._attachGyro();
            this._requestWakeLock();
            onGranted && onGranted();
        }
    }

    _attachGyro() {
        if (this._gyroActive) return;
        window.addEventListener('deviceorientation', e => {
            this.gamma = e.gamma || 0;
            this.beta  = e.beta  || 0;
        });
        this._gyroActive = true;
    }

    // Set current orientation as the "level" reference
    calibrate() {
        this.baseBeta  = this.beta;
        this.baseGamma = this.gamma;
    }

    // Tilt relative to calibrated base
    getRelative() {
        return {
            beta:  this.beta  - this.baseBeta,
            gamma: this.gamma - this.baseGamma
        };
    }

    saveSettings() {
        localStorage.setItem('tilt_sens',   this.sensitivity);
        localStorage.setItem('tilt_maxspd', this.maxSpeed);
    }

    async _requestWakeLock() {
        if ('wakeLock' in navigator) {
            try { this._wakeLock = await navigator.wakeLock.request('screen'); } catch(e) {}
        }
        document.addEventListener('visibilitychange', async () => {
            if (this._wakeLock && document.visibilityState === 'visible') {
                try { this._wakeLock = await navigator.wakeLock.request('screen'); } catch(e) {}
            }
        });
    }

    // Returns true when relative tilt is within threshold
    isLevel(threshold = 20) {
        const rel = this.getRelative();
        return Math.abs(rel.beta) < threshold && Math.abs(rel.gamma) < threshold;
    }

    // Returns tilt for physics (relative to calibration, scaled by sensitivity)
    getTilt() {
        const rel = this.getRelative();
        let x = rel.gamma * this.sensitivity;
        let y = rel.beta  * this.sensitivity;
        const spd = 25;
        if (this._keys['ArrowLeft']  || this._keys['KeyA']) x -= spd;
        if (this._keys['ArrowRight'] || this._keys['KeyD']) x += spd;
        if (this._keys['ArrowUp']    || this._keys['KeyW']) y -= spd;
        if (this._keys['ArrowDown']  || this._keys['KeyS']) y += spd;
        return {
            x: Math.max(-45, Math.min(45, x)),
            y: Math.max(-45, Math.min(45, y))
        };
    }
}
