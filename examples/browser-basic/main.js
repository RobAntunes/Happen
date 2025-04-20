// src/utils/canonicalStringify.ts
function canonicalStringify(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  function replacer(key, val) {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) {
        throw new Error("Cycle detected during canonical stringification");
      }
      seen.add(val);
      if (Array.isArray(val)) {
        return val;
      }
      const sortedKeys = Object.keys(val).sort();
      const sortedObj = {};
      for (const k of sortedKeys) {
        sortedObj[k] = val[k];
      }
      return sortedObj;
    }
    return val;
  }
  return JSON.stringify(value, replacer);
}

// src/core/HappenNode.ts
var HappenNode = class {
  constructor(id, initialState, crypto, emitter) {
    // Store keys in JWK format
    this.publicKey = null;
    this.privateKey = null;
    this.receivedEventIds = /* @__PURE__ */ new Set();
    this.nonce = 0;
    // Array to store disposer functions for cleanup
    this.activeDisposers = [];
    this.id = id;
    this.state = initialState;
    this.crypto = crypto;
    this.emitter = emitter;
  }
  /**
   * Initializes the node by generating its cryptographic key pair.
   * Must be called before emitting signed events or registering listeners
   * that verify signatures.
   */
  async init() {
    if (this.publicKey && this.privateKey) {
      console.warn(`Node ${this.id}: Already initialized.`);
      return;
    }
    try {
      console.log(`Node ${this.id}: Initializing - generating key pair...`);
      const { publicKey, privateKey } = await this.crypto.generateKeyPair();
      this.publicKey = publicKey;
      this.privateKey = privateKey;
      console.log(`Node ${this.id}: Initialization complete. Public key ready.`);
    } catch (error) {
      console.error(`Node ${this.id}: Failed to generate key pair during initialization:`, error);
      throw new Error(`Node ${this.id} initialization failed: ${error}`);
    }
  }
  /**
   * Checks if the node has been initialized with a key pair.
   * @returns True if the node is initialized, false otherwise.
   */
  isInitialized() {
    return !!this.publicKey;
  }
  /**
   * Gets the current state of the node.
   * @returns The current state object.
   */
  getState() {
    return this.state;
  }
  /**
   * Sets the node's state. Provide a new state object or a function
   * that receives the previous state and returns the new state.
   *
   * @param newStateOrFn A new state object, or a function (prevState => newState).
   */
  setState(newStateOrFn) {
    if (typeof newStateOrFn === "function") {
      this.state = newStateOrFn(this.state);
    } else {
      if (typeof this.state === "object" && this.state !== null && typeof newStateOrFn === "object" && newStateOrFn !== null) {
        this.state = { ...this.state, ...newStateOrFn };
      } else {
        this.state = newStateOrFn;
      }
    }
  }
  /**
   * Registers a listener for a specific event type or pattern.
   * Requires node to be initialized via init() first.
   * @param eventTypeOrPattern The event type (exact string) or pattern (with wildcards) to listen for.
   * @param handler The listener function to register.
   * @returns A function that, when called, will unregister the listener.
   */
  on(eventTypeOrPattern, handler) {
    if (!this.isInitialized()) {
      console.error(`Node ${this.id}: Cannot register listener. Node not initialized. Call init() first.`);
      return () => {
      };
    }
    const wrappedHandler = async (event) => {
      if (!event.metadata.signature || !event.metadata.publicKey) {
        console.warn(`${this.id}: Discarding event without signature/publicKey: ${event.metadata.id}`);
        return;
      }
      try {
        const dataToVerifyString = this.getDataToSign(event);
        const dataToVerifyBuffer = new TextEncoder().encode(dataToVerifyString);
        const isValid = await this.crypto.verify(
          event.metadata.publicKey,
          event.metadata.signature,
          dataToVerifyBuffer
        );
        if (!isValid) {
          console.warn(`${this.id}: Discarding event due to INVALID signature: ${event.metadata.id}`);
          return;
        }
      } catch (error) {
        console.error(`${this.id}: Error during signature verification for event ${event.metadata.id}:`, error);
        return;
      }
      if (this.receivedEventIds.has(event.metadata.id)) {
        console.warn(`${this.id}: Discarding duplicate event: ${event.metadata.id}`);
        return;
      }
      this.receivedEventIds.add(event.metadata.id);
      try {
        await handler(event);
      } catch (error) {
        console.error(`${this.id}: Error in handler for ${event.type}:`, error);
      }
    };
    this.emitter.on(eventTypeOrPattern, wrappedHandler);
    const dispose = () => {
      console.log(`${this.id}: Disposing listener for ${eventTypeOrPattern}`);
      if (!this.emitter.off) {
        console.warn(`${this.id}: Underlying emitter does not support 'off' method. Cannot dispose listener for ${eventTypeOrPattern}.`);
        return;
      }
      try {
        this.emitter.off(eventTypeOrPattern, wrappedHandler);
        this.activeDisposers = this.activeDisposers.filter((d) => d !== dispose);
      } catch (error) {
        console.error(`${this.id}: Error during emitter.off for ${eventTypeOrPattern}:`, error);
      }
    };
    this.activeDisposers.push(dispose);
    return dispose;
  }
  /**
   * Emits a signed event to the network.
   * Requires node to be initialized via init() first.
   * @param eventData The core event data (type, payload, optional metadata overrides).
   */
  async emit(eventData) {
    if (!this.isInitialized() || !this.privateKey) {
      console.error(`Node ${this.id}: Cannot emit event. Node not initialized or missing keys. Call init() first.`);
      return;
    }
    const now = Date.now();
    const eventId = eventData.metadata?.id ?? this.crypto.randomUUID();
    const baseMetadata = {
      ...eventData.metadata,
      id: eventId,
      sender: this.id,
      timestamp: now
    };
    const eventToSign = {
      type: eventData.type,
      payload: eventData.payload,
      metadata: baseMetadata
    };
    try {
      const dataToSignString = this.getDataToSign(eventToSign);
      const dataToSignBuffer = new TextEncoder().encode(dataToSignString);
      const signature = await this.crypto.sign(this.privateKey, dataToSignBuffer);
      const finalEvent = {
        type: eventData.type,
        payload: eventData.payload === void 0 ? {} : eventData.payload,
        metadata: {
          ...baseMetadata,
          publicKey: this.publicKey,
          // Add public key
          signature
          // Add signature
        }
      };
      this.emitter.emit(finalEvent.type, finalEvent);
    } catch (error) {
      console.error(`Node ${this.id}: Failed to sign or emit event:`, error);
    }
  }
  /**
   * Helper method to consistently generate the string representation of event data
   * that needs to be signed or verified.
   */
  getDataToSign(event) {
    const signedData = {
      type: event.type,
      payload: event.payload,
      metadata: {
        id: event.metadata?.id,
        sender: event.metadata?.sender,
        timestamp: event.metadata?.timestamp,
        causationId: event.metadata?.causationId,
        correlationId: event.metadata?.correlationId
      }
    };
    return canonicalStringify(signedData);
  }
  /**
   * Cleans up resources used by the node, including removing listeners
   * and stopping timers.
   */
  destroy() {
    console.log(`Node ${this.id}: Destroying...`);
    if (this.nonceCleanupTimer) {
      clearInterval(this.nonceCleanupTimer);
      this.nonceCleanupTimer = void 0;
      console.log(`Node ${this.id}: Stopped nonce cleanup timer.`);
    }
    [...this.activeDisposers].forEach((dispose) => {
      try {
        dispose();
      } catch (error) {
        console.error(`Node ${this.id}: Error during listener disposal on destroy:`, error);
      }
    });
    this.activeDisposers = [];
    this.receivedEventIds.clear();
    console.log(`Node ${this.id}: Destroyed.`);
  }
};

// src/runtime/BrowserCrypto.ts
function bufferToBase64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function base64UrlToBuffer(base64Url) {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const binStr = atob(base64);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes.buffer;
}
var BrowserCrypto = class {
  constructor() {
    this.defaultSignAlgo = { name: "ECDSA", hash: "SHA-256" };
    this.defaultKeyAlgo = { name: "ECDSA", namedCurve: "P-256" };
    if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
      throw new Error("Web Crypto API (window.crypto.subtle) is not available in this environment.");
    }
    this.subtle = window.crypto.subtle;
  }
  randomUUID() {
    if (!window.crypto.randomUUID) {
      console.warn("crypto.randomUUID not available, using basic fallback (NOT secure).");
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == "x" ? r : r & 3 | 8;
        return v.toString(16);
      });
    }
    return window.crypto.randomUUID();
  }
  async hash(data, encoding = "hex") {
    let buffer;
    if (typeof data === "string") {
      buffer = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer) {
      buffer = data;
    } else if (ArrayBuffer.isView(data)) {
      buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } else {
      throw new Error("Unsupported data type for hash");
    }
    const hashBuffer = await this.subtle.digest("SHA-256", buffer);
    if (encoding === "hex") {
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } else if (encoding === "base64") {
      return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
    } else if (encoding === "base64url") {
      return bufferToBase64Url(hashBuffer);
    }
    throw new Error(`Unsupported hash encoding: ${encoding}`);
  }
  async generateKeyPair() {
    const keyPair = await this.subtle.generateKey(
      this.defaultKeyAlgo,
      true,
      // extractable
      ["sign", "verify"]
    );
    const publicKeyJwk = await this.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKeyJwk = await this.subtle.exportKey("jwk", keyPair.privateKey);
    return { publicKey: publicKeyJwk, privateKey: privateKeyJwk };
  }
  async sign(privateKeyJwk, data) {
    const privateKey = await this.subtle.importKey(
      "jwk",
      privateKeyJwk,
      this.defaultKeyAlgo,
      true,
      // extractable must be true to import JWK
      ["sign"]
    );
    const signatureBuffer = await this.subtle.sign(
      this.defaultSignAlgo,
      privateKey,
      data
    );
    return bufferToBase64Url(signatureBuffer);
  }
  async verify(publicKeyJwk, signature, data) {
    const publicKey = await this.subtle.importKey(
      "jwk",
      publicKeyJwk,
      this.defaultKeyAlgo,
      true,
      // extractable must be true to import JWK
      ["verify"]
    );
    const signatureBuffer = base64UrlToBuffer(signature);
    const isValid = await this.subtle.verify(
      this.defaultSignAlgo,
      publicKey,
      signatureBuffer,
      data
    );
    return isValid;
  }
};

// src/runtime/BrowserEventEmitter.ts
var DEFAULT_CHANNEL_NAME = "happen-channel";
var BrowserEventEmitter = class {
  // Default, mirroring Node
  /**
   * Creates a new BrowserEventEmitter.
   * @param channelName Optional name for the BroadcastChannel. Defaults to 'happen-channel'.
   */
  constructor(channelName = DEFAULT_CHANNEL_NAME) {
    this.maxListeners = 10;
    if (typeof window === "undefined" || !window.BroadcastChannel) {
      throw new Error("BroadcastChannel API is not available in this environment.");
    }
    this.channel = new BroadcastChannel(channelName);
    this.listeners = /* @__PURE__ */ new Map();
    this.channel.onmessage = (event) => {
      const { type, args } = event.data;
      const eventListeners = this.listeners.get(type);
      if (eventListeners) {
        eventListeners.forEach((listener) => {
          try {
            listener(...args);
          } catch (error) {
            console.error("Error in BroadcastChannel event listener:", error);
          }
        });
      }
    };
    this.channel.onmessageerror = (event) => {
      console.error("BroadcastChannel message error:", event);
    };
  }
  on(eventName, listener) {
    let eventListeners = this.listeners.get(eventName);
    if (!eventListeners) {
      eventListeners = /* @__PURE__ */ new Set();
      this.listeners.set(eventName, eventListeners);
    }
    eventListeners.add(listener);
    if (eventListeners.size > this.maxListeners && this.maxListeners > 0) {
      console.warn(`Possible BroadcastChannel memory leak detected. ${eventListeners.size} listeners added for event "${String(eventName)}". Use emitter.setMaxListeners() to increase limit.`);
    }
    return this;
  }
  off(eventName, listener) {
    const eventListeners = this.listeners.get(eventName);
    if (eventListeners) {
      eventListeners.delete(listener);
      if (eventListeners.size === 0) {
        this.listeners.delete(eventName);
      }
    }
    return this;
  }
  emit(eventName, ...args) {
    const message = { type: eventName, args };
    try {
      this.channel.postMessage(message);
      return true;
    } catch (error) {
      console.error("BroadcastChannel postMessage error:", error);
      return false;
    }
  }
  setMaxListeners(n) {
    if (n < 0) throw new Error("setMaxListeners: n must be a positive number");
    this.maxListeners = n;
    return this;
  }
  /**
   * Closes the BroadcastChannel.
   * Essential for cleanup to allow garbage collection.
   */
  close() {
    this.channel.close();
    this.listeners.clear();
    console.log(`BroadcastChannel '${this.channel.name}' closed.`);
  }
};

// src/core/emitter.ts
var GENERIC_EVENT_SIGNAL = Symbol.for("happenInternalGenericEvent");

// src/utils/patternUtils.ts
function compilePatternToRegex(pattern, separator = "-") {
  if (typeof pattern !== "string") {
    throw new Error("Pattern must be a string.");
  }
  const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let regexString = pattern.replace(/[.+?^$()|[\]\\]/g, "\\$&");
  regexString = regexString.replace(/\{([^}]+)\}/g, (match, alternatives) => {
    if (!alternatives) throw new Error(`Invalid pattern: Empty alternatives found in ${pattern}`);
    const parts = alternatives.split(",").map((s) => s.trim()).filter((s) => s).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (parts.length === 0) throw new Error(`Invalid pattern: No valid alternatives in ${match} in ${pattern}`);
    return "(?:" + parts.join("|") + ")";
  });
  regexString = regexString.replace(/\*/g, `([^${escapedSeparator}]+)`);
  return new RegExp("^" + regexString + "$");
}

// src/core/PatternEmitter.ts
var PatternEmitter = class {
  // Keep track for internal use if needed
  /**
   * Creates a new PatternEmitter.
   * @param injectedEmitter An instance conforming to IEventEmitter (e.g., from HappenRuntimeModules).
   */
  constructor(injectedEmitter) {
    // Use the injected emitter instance
    // Store pattern listeners separately
    this.patternListeners = [];
    this.hasGenericListener = false;
    this.boundGenericHandler = null;
    // Store the bound handler
    this.observers = [];
    // Store active observers
    this.maxListeners = 10;
    this.internalEmitter = injectedEmitter;
    this.internalEmitter.setMaxListeners(this.maxListeners);
  }
  /**
   * Emits an event.
   * Notifies observers first, then fires exact match listeners and pattern listeners.
   */
  emit(eventType, event) {
    if (this.observers.length > 0) {
      Promise.allSettled(this.observers.map((observer) => {
        try {
          return Promise.resolve(observer(event));
        } catch (syncError) {
          console.error(`PatternEmitter: Synchronous error in observer for event type '${eventType}':`, syncError);
          return Promise.reject(syncError);
        }
      })).then((results) => {
        results.forEach((result) => {
          if (result.status === "rejected") {
            console.error(`PatternEmitter: Asynchronous error in observer for event type '${eventType}':`, result.reason);
          }
        });
      });
    }
    let exactListenersFired = false;
    try {
      exactListenersFired = this.internalEmitter.emit(eventType, event);
    } catch (error) {
      console.error(`PatternEmitter: Error during exact emit for type '${eventType}':`, error);
    }
    let genericSignalFired = false;
    if (this.patternListeners.length > 0) {
      try {
        genericSignalFired = this.internalEmitter.emit(GENERIC_EVENT_SIGNAL, event);
      } catch (error) {
        console.error(`PatternEmitter: Error during generic signal emit for type '${eventType}':`, error);
      }
    }
    if (exactListenersFired) {
    }
    if (genericSignalFired) {
    }
  }
  /**
   * Registers a listener.
   * If it's an exact match, uses the internal emitter's .on directly.
   * If it uses patterns, stores it for checking against the generic signal.
   */
  on(patternOrEventType, listener) {
    if (!/[{}*]/.test(patternOrEventType)) {
      console.log(`PatternEmitter: Registering exact listener for '${patternOrEventType}'`);
      this.internalEmitter.on(patternOrEventType, listener);
    } else {
      try {
        const regex = compilePatternToRegex(patternOrEventType);
        console.log(`PatternEmitter: Registering pattern listener for '${patternOrEventType}'`);
        this.patternListeners.push({ pattern: patternOrEventType, listener, regex });
        this.ensureGenericListener();
      } catch (e) {
        console.error(`PatternEmitter: Failed to register invalid pattern '${patternOrEventType}':`, e);
      }
    }
  }
  /**
   * Removes a listener.
   * Handles removing both exact and pattern listeners.
   */
  off(patternOrEventType, listener) {
    if (!/[{}*]/.test(patternOrEventType)) {
      console.log(`PatternEmitter: Removing exact listener for '${patternOrEventType}'`);
      if (this.internalEmitter.off) {
        this.internalEmitter.off(patternOrEventType, listener);
      } else {
        console.warn(`PatternEmitter: Underlying emitter does not support 'off' method.`);
      }
    } else {
      console.log(`PatternEmitter: Removing pattern listener for '${patternOrEventType}'`);
      const initialLength = this.patternListeners.length;
      this.patternListeners = this.patternListeners.filter(
        (entry) => !(entry.pattern === patternOrEventType && entry.listener === listener)
      );
      if (this.patternListeners.length === 0 && initialLength > 0 && this.hasGenericListener) {
        console.log("PatternEmitter: Removing generic listener as no pattern listeners remain.");
        if (this.internalEmitter.off && this.boundGenericHandler) {
          this.internalEmitter.off(GENERIC_EVENT_SIGNAL, this.boundGenericHandler);
          this.hasGenericListener = false;
          this.boundGenericHandler = null;
        } else {
          console.warn(`PatternEmitter: Cannot remove generic listener; underlying emitter missing 'off' or handler not bound.`);
        }
      }
    }
  }
  /**
   * Attaches the single generic listener to the internal emitter.
   */
  ensureGenericListener() {
    if (!this.hasGenericListener) {
      console.log("PatternEmitter: Attaching generic listener for pattern matching.");
      this.boundGenericHandler = this.handleGenericEvent.bind(this);
      this.internalEmitter.on(GENERIC_EVENT_SIGNAL, this.boundGenericHandler);
      this.hasGenericListener = true;
    }
  }
  /**
   * Handler for the generic event signal from the internal emitter.
   * Checks all registered pattern listeners against the incoming event.
   */
  handleGenericEvent(event) {
    this.patternListeners.forEach((entry) => {
      try {
        if (entry.regex.test(event.type)) {
          Promise.resolve(entry.listener(event)).catch((err) => {
            console.error(`PatternEmitter: Error in pattern listener for pattern '${entry.pattern}' on event type '${event.type}':`, err);
          });
        }
      } catch (matchError) {
        console.error(`PatternEmitter: Error matching pattern '${entry.pattern}' against type '${event.type}':`, matchError);
      }
    });
  }
  /**
   * Registers a passive event observer.
   * @param observer The observer function.
   * @returns A dispose function to remove the observer.
   */
  addObserver(observer) {
    this.observers.push(observer);
    console.log("PatternEmitter: Registered an observer.");
    return () => {
      this.observers = this.observers.filter((obs) => obs !== observer);
      console.log("PatternEmitter: Disposed an observer.");
    };
  }
  // --- Implement setMaxListeners --- //
  setMaxListeners(n) {
    if (n < 0) throw new Error("setMaxListeners: n must be a positive number");
    this.maxListeners = n;
    this.internalEmitter.setMaxListeners(n);
    return this;
  }
};

// examples/browser-basic/main.ts
var logDiv = document.getElementById("log");
function log(message) {
  if (logDiv) {
    const time = (/* @__PURE__ */ new Date()).toLocaleTimeString();
    logDiv.textContent += `[${time}] ${message}
`;
    logDiv.scrollTop = logDiv.scrollHeight;
  }
  console.log(message);
}
log("Setting up Happen components...");
var nodeA = null;
var nodeB = null;
var disposeA = null;
var disposeB = null;
try {
  let registerListeners = function() {
    if (!nodeA || !nodeB) return;
    log("Registering listeners...");
    disposeA = nodeA.on("pong", (event) => {
      log(`[NodeA] Received '${event.type}' from ${event.metadata.sender}.`);
    });
    disposeB = nodeB.on("ping", (event) => {
      log(`[NodeB] Received '${event.type}' from ${event.metadata.sender}. Updating state.`);
      const state = nodeB?.getState();
      if (state) {
        nodeB?.setState({ pongsReceived: state.pongsReceived + 1 });
        log(`[NodeB] New state: ${JSON.stringify(nodeB?.getState())}`);
      }
    });
    log("Listeners registered.");
  };
  registerListeners2 = registerListeners;
  const crypto = new BrowserCrypto();
  const baseEmitter = new BrowserEventEmitter("happen-demo-channel");
  const happenEmitter = new PatternEmitter(baseEmitter);
  nodeA = new HappenNode("NodeA", { pingsSent: 0 }, crypto, happenEmitter);
  nodeB = new HappenNode("NodeB", { pongsReceived: 0 }, crypto, happenEmitter);
  log("Nodes created (but not initialized).");
  let testStatus = "PENDING";
  document.getElementById("btnInitA")?.addEventListener("click", async () => {
    if (!nodeA?.isInitialized()) {
      log("Initializing Node A...");
      await nodeA?.init();
      log("Node A Initialized.");
      if (nodeB?.isInitialized()) registerListeners();
    } else {
      log("Node A already initialized.");
    }
  });
  document.getElementById("btnInitB")?.addEventListener("click", async () => {
    if (!nodeB?.isInitialized()) {
      log("Initializing Node B...");
      await nodeB?.init();
      log("Node B Initialized.");
      if (nodeA?.isInitialized()) registerListeners();
    } else {
      log("Node B already initialized.");
    }
  });
  document.getElementById("btnEmitA")?.addEventListener("click", async () => {
    if (!nodeA?.isInitialized()) {
      log("Node A must be initialized to emit.");
      return;
    }
    log("[NodeA] Emitting ping...");
    const state = nodeA.getState();
    await nodeA.emit({ type: "ping", payload: { count: state.pingsSent + 1 } });
    nodeA.setState({ pingsSent: state.pingsSent + 1 });
    log(`[NodeA] Ping emitted. New state: ${JSON.stringify(nodeA.getState())}`);
    setTimeout(() => {
      const stateB = nodeB?.getState();
      if (stateB?.pongsReceived > 0) {
        log("TEST_ASSERT: Node B received ping. PASS");
      } else {
        log("TEST_ASSERT: Node B did NOT receive ping. FAIL");
        testStatus = "FAIL";
      }
      log(`TEST_RESULT: ${testStatus !== "FAIL" ? "PASS" : "FAIL"}`);
    }, 200);
  });
  document.getElementById("btnEmitB")?.addEventListener("click", async () => {
    if (!nodeB?.isInitialized()) {
      log("Node B must be initialized to emit.");
      return;
    }
    log("[NodeB] Emitting pong...");
    await nodeB.emit({ type: "pong", payload: {} });
    log(`[NodeB] Pong emitted.`);
  });
  HappenNode.prototype.isInitialized = function() {
    return !!this.publicKey;
  };
  log("UI Ready.");
} catch (error) {
  log(`Error setting up Happen: ${error}`);
  console.error(error);
  log("TEST_RESULT: FAIL");
}
var registerListeners2;
window.addEventListener("beforeunload", () => {
  disposeA?.();
  disposeB?.();
  log("Listeners disposed on page unload.");
});
