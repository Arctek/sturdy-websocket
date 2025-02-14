"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var SHOULD_RECONNECT_FALSE_MESSAGE = "Provided shouldReconnect() returned false. Closing permanently.";
var SHOULD_RECONNECT_PROMISE_FALSE_MESSAGE = "Provided shouldReconnect() resolved to false. Closing permanently.";
var SturdyWebSocket = /** @class */ (function () {
    function SturdyWebSocket(url, protocolsOrOptions, options) {
        if (options === void 0) { options = {}; }
        this.url = url;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
        this.onopen = null;
        this.ondown = null;
        this.onreopen = null;
        this.onpong = null;
        this.CONNECTING = SturdyWebSocket.CONNECTING;
        this.OPEN = SturdyWebSocket.OPEN;
        this.CLOSING = SturdyWebSocket.CLOSING;
        this.CLOSED = SturdyWebSocket.CLOSED;
        this.hasBeenOpened = false;
        this.isClosed = false;
        this.messageBuffer = [];
        this.nextRetryTime = 0;
        this.reconnectCount = 0;
        this.lastKnownExtensions = "";
        this.lastKnownProtocol = "";
        this.listeners = {};
        if (protocolsOrOptions == null ||
            typeof protocolsOrOptions === "string" ||
            Array.isArray(protocolsOrOptions)) {
            this.protocols = protocolsOrOptions;
        }
        else {
            options = protocolsOrOptions;
        }
        this.options = applyDefaultOptions(options);
        if (!this.options.wsConstructor) {
            if (typeof WebSocket !== "undefined") {
                this.options.wsConstructor = WebSocket;
            }
            else {
                throw new Error("WebSocket not present in global scope and no " +
                    "wsConstructor option was provided.");
            }
        }
        this.openNewWebSocket();
    }
    Object.defineProperty(SturdyWebSocket.prototype, "binaryType", {
        get: function () {
            return this.binaryTypeInternal || "blob";
        },
        set: function (binaryType) {
            this.binaryTypeInternal = binaryType;
            if (this.ws) {
                this.ws.binaryType = binaryType;
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(SturdyWebSocket.prototype, "bufferedAmount", {
        get: function () {
            var sum = this.ws ? this.ws.bufferedAmount : 0;
            var hasUnknownAmount = false;
            this.messageBuffer.forEach(function (data) {
                var byteLength = getDataByteLength(data);
                if (byteLength != null) {
                    sum += byteLength;
                }
                else {
                    hasUnknownAmount = true;
                }
            });
            if (hasUnknownAmount) {
                this.debugLog("Some buffered data had unknown length. bufferedAmount()" +
                    " return value may be below the correct amount.");
            }
            return sum;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(SturdyWebSocket.prototype, "extensions", {
        get: function () {
            return this.ws ? this.ws.extensions : this.lastKnownExtensions;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(SturdyWebSocket.prototype, "protocol", {
        get: function () {
            return this.ws ? this.ws.protocol : this.lastKnownProtocol;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(SturdyWebSocket.prototype, "readyState", {
        get: function () {
            return this.isClosed ? SturdyWebSocket.CLOSED : SturdyWebSocket.OPEN;
        },
        enumerable: true,
        configurable: true
    });
    SturdyWebSocket.prototype.close = function (code, reason) {
        this.disposeSocket(code, reason);
        this.shutdown();
        this.debugLog("WebSocket permanently closed by client.");
    };
    SturdyWebSocket.prototype.ping = function () {
        if (this.ws && this.ws.readyState === this.OPEN) {
            this.ws.ping(noop);
        }
    };
    SturdyWebSocket.prototype.send = function (data) {
        if (this.ws && this.ws.readyState === this.OPEN) {
            this.ws.send(data);
        }
        else {
            this.messageBuffer.push(data);
        }
    };
    SturdyWebSocket.prototype.reconnect = function () {
        if (this.isClosed) {
            throw new Error("Cannot call reconnect() on socket which is permanently closed.");
        }
        this.disposeSocket(1000, "Client requested reconnect.");
        this.handleClose(undefined);
    };
    SturdyWebSocket.prototype.addEventListener = function (type, listener) {
        if (!this.listeners[type]) {
            this.listeners[type] = [];
        }
        this.listeners[type].push(listener);
    };
    SturdyWebSocket.prototype.dispatchEvent = function (event) {
        return this.dispatchEventOfType(event.type, event);
    };
    SturdyWebSocket.prototype.removeEventListener = function (type, listener) {
        if (this.listeners[type]) {
            this.listeners[type] = this.listeners[type].filter(function (l) { return l !== listener; });
        }
    };
    SturdyWebSocket.prototype.openNewWebSocket = function () {
        var _this = this;
        if (this.isClosed) {
            return;
        }
        var _a = this.options, connectTimeout = _a.connectTimeout, wsConstructor = _a.wsConstructor;
        this.debugLog("Opening new WebSocket to " + this.url + ".");
        var ws = new wsConstructor(this.url, this.protocols);
        ws.onclose = function (event) { return _this.handleClose(event); };
        ws.onerror = function (event) { return _this.handleError(event); };
        ws.onmessage = function (event) { return _this.handleMessage(event); };
        ws.onopen = function (event) { return _this.handleOpen(event); };
        this.connectTimeoutId = setTimeout(function () {
            // If this is running, we still haven't opened the websocket.
            // Kill it so we can try again.
            _this.clearConnectTimeout();
            _this.disposeSocket();
            _this.handleClose(undefined);
        }, connectTimeout);
        ws.on('pong', function (event) { return _this.handlePong(event); });
        this.ws = ws;
    };
    SturdyWebSocket.prototype.handleOpen = function (event) {
        var _this = this;
        if (!this.ws || this.isClosed) {
            return;
        }
        var allClearResetTime = this.options.allClearResetTime;
        this.debugLog("WebSocket opened.");
        if (this.binaryTypeInternal != null) {
            this.ws.binaryType = this.binaryTypeInternal;
        }
        else {
            this.binaryTypeInternal = this.ws.binaryType;
        }
        this.clearConnectTimeout();
        if (this.hasBeenOpened) {
            this.dispatchEventOfType("reopen", event);
        }
        else {
            this.dispatchEventOfType("open", event);
            this.hasBeenOpened = true;
        }
        this.messageBuffer.forEach(function (message) { return _this.send(message); });
        this.messageBuffer = [];
        this.allClearTimeoutId = setTimeout(function () {
            _this.clearAllClearTimeout();
            _this.nextRetryTime = 0;
            _this.reconnectCount = 0;
            var openTime = (allClearResetTime / 1000) | 0;
            _this.debugLog("WebSocket remained open for " + openTime + " seconds. Resetting" +
                " retry time and count.");
        }, allClearResetTime);
    };
    SturdyWebSocket.prototype.handleMessage = function (event) {
        if (this.isClosed) {
            return;
        }
        this.dispatchEventOfType("message", event);
    };
    SturdyWebSocket.prototype.handlePong = function (event) {
        if (this.isClosed) {
            return;
        }
        this.dispatchEventOfType("pong", event);
    };
    SturdyWebSocket.prototype.handleClose = function (event) {
        var _this = this;
        if (this.isClosed) {
            return;
        }
        var _a = this.options, maxReconnectAttempts = _a.maxReconnectAttempts, shouldReconnect = _a.shouldReconnect;
        this.clearConnectTimeout();
        this.clearAllClearTimeout();
        if (this.ws) {
            this.lastKnownExtensions = this.ws.extensions;
            this.lastKnownProtocol = this.ws.protocol;
            this.ws = undefined;
        }
        this.dispatchEventOfType("down", event);
        if (this.reconnectCount >= maxReconnectAttempts) {
            this.stopReconnecting(event, this.getTooManyFailedReconnectsMessage());
            return;
        }
        var willReconnect = !event || shouldReconnect(event);
        if (typeof willReconnect === "boolean") {
            this.handleWillReconnect(willReconnect, event, SHOULD_RECONNECT_FALSE_MESSAGE);
        }
        else {
            willReconnect.then(function (willReconnectResolved) {
                if (_this.isClosed) {
                    return;
                }
                _this.handleWillReconnect(willReconnectResolved, event, SHOULD_RECONNECT_PROMISE_FALSE_MESSAGE);
            });
        }
    };
    SturdyWebSocket.prototype.handleError = function (event) {
        this.dispatchEventOfType("error", event);
        this.debugLog("WebSocket encountered an error.");
    };
    SturdyWebSocket.prototype.handleWillReconnect = function (willReconnect, event, denialReason) {
        if (willReconnect) {
            this.reestablishConnection();
        }
        else {
            this.stopReconnecting(event, denialReason);
        }
    };
    SturdyWebSocket.prototype.reestablishConnection = function () {
        var _this = this;
        var _a = this.options, minReconnectDelay = _a.minReconnectDelay, maxReconnectDelay = _a.maxReconnectDelay, reconnectBackoffFactor = _a.reconnectBackoffFactor;
        this.reconnectCount++;
        var retryTime = this.nextRetryTime;
        this.nextRetryTime = Math.max(minReconnectDelay, Math.min(this.nextRetryTime * reconnectBackoffFactor, maxReconnectDelay));
        setTimeout(function () { return _this.openNewWebSocket(); }, retryTime);
        var retryTimeSeconds = (retryTime / 1000) | 0;
        this.debugLog("WebSocket was closed. Re-opening in " + retryTimeSeconds + " seconds.");
    };
    SturdyWebSocket.prototype.stopReconnecting = function (event, debugReason) {
        this.debugLog(debugReason);
        this.shutdown();
        if (event) {
            this.dispatchEventOfType("close", event);
        }
    };
    SturdyWebSocket.prototype.shutdown = function () {
        this.isClosed = true;
        this.clearAllTimeouts();
        this.messageBuffer = [];
    };
    SturdyWebSocket.prototype.disposeSocket = function (closeCode, reason) {
        if (!this.ws) {
            return;
        }
        // Use noop handlers instead of null because some WebSocket
        // implementations, such as the one from isomorphic-ws, raise a stink on
        // unhandled events.
        this.ws.onerror = noop;
        this.ws.onclose = noop;
        this.ws.onmessage = noop;
        this.ws.onopen = noop;
        this.ws.close(closeCode, reason);
        this.ws = undefined;
    };
    SturdyWebSocket.prototype.clearAllTimeouts = function () {
        this.clearConnectTimeout();
        this.clearAllClearTimeout();
    };
    SturdyWebSocket.prototype.clearConnectTimeout = function () {
        if (this.connectTimeoutId != null) {
            clearTimeout(this.connectTimeoutId);
            this.connectTimeoutId = undefined;
        }
    };
    SturdyWebSocket.prototype.clearAllClearTimeout = function () {
        if (this.allClearTimeoutId != null) {
            clearTimeout(this.allClearTimeoutId);
            this.allClearTimeoutId = undefined;
        }
    };
    SturdyWebSocket.prototype.dispatchEventOfType = function (type, event) {
        var _this = this;
        switch (type) {
            case "close":
                if (this.onclose) {
                    this.onclose(event);
                }
                break;
            case "error":
                if (this.onerror) {
                    this.onerror(event);
                }
                break;
            case "pong":
                if (this.onpong) {
                    this.onpong(event);
                }
                break;
            case "message":
                if (this.onmessage) {
                    this.onmessage(event);
                }
                break;
            case "open":
                if (this.onopen) {
                    this.onopen(event);
                }
                break;
            case "down":
                if (this.ondown) {
                    this.ondown(event);
                }
                break;
            case "reopen":
                if (this.onreopen) {
                    this.onreopen(event);
                }
                break;
        }
        if (type in this.listeners) {
            this.listeners[type]
                .slice()
                .forEach(function (listener) { return _this.callListener(listener, event); });
        }
        return !event || !event.defaultPrevented;
    };
    SturdyWebSocket.prototype.callListener = function (listener, event) {
        if (typeof listener === "function") {
            listener.call(this, event);
        }
        else {
            listener.handleEvent.call(this, event);
        }
    };
    SturdyWebSocket.prototype.debugLog = function (message) {
        if (this.options.debug) {
            // tslint:disable-next-line:no-console
            console.log(message);
        }
    };
    SturdyWebSocket.prototype.getTooManyFailedReconnectsMessage = function () {
        var maxReconnectAttempts = this.options.maxReconnectAttempts;
        return "Failed to reconnect after " + maxReconnectAttempts + " " + pluralize("attempt", maxReconnectAttempts) + ". Closing permanently.";
    };
    SturdyWebSocket.DEFAULT_OPTIONS = {
        allClearResetTime: 5000,
        connectTimeout: 5000,
        debug: false,
        minReconnectDelay: 1000,
        maxReconnectDelay: 30000,
        maxReconnectAttempts: Number.POSITIVE_INFINITY,
        reconnectBackoffFactor: 1.5,
        shouldReconnect: function () { return true; },
        wsConstructor: undefined,
    };
    SturdyWebSocket.CONNECTING = 0;
    SturdyWebSocket.OPEN = 1;
    SturdyWebSocket.CLOSING = 2;
    SturdyWebSocket.CLOSED = 3;
    return SturdyWebSocket;
}());
exports.default = SturdyWebSocket;
function applyDefaultOptions(options) {
    var result = {};
    Object.keys(SturdyWebSocket.DEFAULT_OPTIONS).forEach(function (key) {
        var value = options[key];
        result[key] =
            value === undefined
                ? SturdyWebSocket.DEFAULT_OPTIONS[key]
                : value;
    });
    return result;
}
function getDataByteLength(data) {
    if (typeof data === "string") {
        // UTF-16 strings use two bytes per character.
        return 2 * data.length;
    }
    else if (data instanceof ArrayBuffer) {
        return data.byteLength;
    }
    else if (data instanceof Blob) {
        return data.size;
    }
    else {
        return undefined;
    }
}
function pluralize(s, n) {
    return n === 1 ? s : s + "s";
}
function noop() {
    // Nothing.
}
//# sourceMappingURL=index.js.map