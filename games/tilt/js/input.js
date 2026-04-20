// Input handler: gyroscope + keyboard fallback
// iOS13+: requestPermission() must be called synchronously from a user gesture

class InputHandler {
    constructor() {
        this.tiltX = 0;
        this.tiltY = 0;
        this.beta  = 0;
        this.gamma = 0;
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
            this.tiltX = this.gamma;
            this.tiltY = this.beta;
        });
        this._gyroActive = true;
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

    // Returns true when phone is near-level (flat, face-up)
    isLevel(threshold = 20) {
        return Math.abs(this.beta) < threshold && Math.abs(this.gamma) < threshold;
    }

    getTilt() {
        let x = this.tiltX;
        let y = this.tiltY;
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
