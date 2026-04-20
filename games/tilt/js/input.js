// Input handler: gyroscope + keyboard fallback

class InputHandler {
    constructor() {
        this.tiltX = 0;   // positive = right
        this.tiltY = 0;   // positive = down
        this._keys = {};
        this._listening = false;
        this._wakeLock = null;
        this._bindKeys();
    }

    _bindKeys() {
        window.addEventListener('keydown', e => { this._keys[e.code] = true; });
        window.addEventListener('keyup',   e => { this._keys[e.code] = false; });
    }

    async start() {
        if (this._listening) return;

        await this._requestWakeLock();

        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS 13+
            try {
                const state = await DeviceOrientationEvent.requestPermission();
                if (state === 'granted') this._attachGyro();
            } catch(e) { console.warn('Gyro permission denied', e); }
        } else {
            this._attachGyro();
        }
        this._listening = true;
    }

    _attachGyro() {
        window.addEventListener('deviceorientation', e => {
            // gamma: left/right tilt (-90 to 90), beta: front/back tilt (-180 to 180)
            this.tiltX = (e.gamma || 0) * 0.9;
            this.tiltY = (e.beta  || 0) * 0.9;
        });
    }

    async _requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this._wakeLock = await navigator.wakeLock.request('screen');
            } catch(e) { /* ignore */ }
        }
        document.addEventListener('visibilitychange', async () => {
            if (this._wakeLock && document.visibilityState === 'visible') {
                try { this._wakeLock = await navigator.wakeLock.request('screen'); } catch(e) {}
            }
        });
    }

    // Returns {x, y} tilt values, applying keyboard override when no gyro
    getTilt() {
        let x = this.tiltX;
        let y = this.tiltY;

        // Keyboard override (for desktop testing)
        const spd = 20;
        if (this._keys['ArrowLeft']  || this._keys['KeyA']) x -= spd;
        if (this._keys['ArrowRight'] || this._keys['KeyD']) x += spd;
        if (this._keys['ArrowUp']    || this._keys['KeyW']) y -= spd;
        if (this._keys['ArrowDown']  || this._keys['KeyS']) y += spd;

        // Clamp to reasonable range
        x = Math.max(-45, Math.min(45, x));
        y = Math.max(-45, Math.min(45, y));
        return {x, y};
    }
}
