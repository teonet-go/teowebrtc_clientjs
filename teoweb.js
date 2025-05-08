'use strict';

const version = "0.2.2";

// Import TeoProxyClient, TeoWebtransport class and Command enum
import TeoProxyClient from "./teoproxy.js";
import TeoWebtransport from "./teowebtransport.js";
import { Command } from "./teoproxy.js";

/**
 * Create teoweb object
 *
 */
function teoweb(connectType = "webrtc") {
    const cmdSubscribe = "subscribe";

    let rtc_id = 0;
    let onopen = null;
    let onclose = null;
    let connected = false;
    let reconnectId;

    // Signal and WebRTC objects
    let ws;
    let pc;

    // Map for readers
    const m = mapCreate();

    // Map for websocket send commands
    const mp = mapCreate();

    // Common server methods
    const serverCommon = {

        connectType: connectType,

        /** Set on dc open function */
        onOpen: function (f) {
            onopen = f;
        },

        /** Set on dc or webrtc close function */
        onClose: function (f) {
            onclose = f;
        },

        /** Add reader */
        addReader: function (f) {
            return m.add(f);
        },

        /** Remove reader bye key returned from addReader() function */
        delReader: function (key) {
            m.del(key);
        },

        /** Return true if we are connected to WebRTC data channel now */
        connected() {
            return this.dc !== null && connected;
        },

        /** 
         * Waits for the data channel to be connected and calls the function f
         * @param {()=>void} f function called when the data channel is connected
         * 
        */
        whenConnected(f) {
            if (this.connected()) {
                f();
                return;
            }
            setTimeout(() => {
                this.whenConnected(f);
            }, "5");
        },

        /** Send request with subscribe command to WebRTC server */
        subscribeCmd: function (cmd) {
            this.sendCmd(cmdSubscribe, cmd);
        },

        /** WebRTC or WebSocket datachannel or NULL if not connected */
        dc: null,

        /** Users field to save authentication token. Used on client part to 
         * save some unical values */
        token: null,
    };

    // WebRTC server methods
    const serverWebRTC = {
        /**
         * Connect to Teonet WebRTC server
         * 
         * @param {string} addr the WebRTC signal server address
         * @param {string} login this web application name
         * @param {string} server server name
         * @param {bool} auto reconnect when connection to server is lost
         */
        connect: function (addr, login, server, autoReconnect = true) {

            console.debug("webrtc teoweb.connect started ver. " + version);

            const that = this;
            let processWebrtc;
            const startTime = Date.now();

            // Close signal server ws connection when local and remote ice 
            // candidate are done
            let localDone = false;
            let remoteDone = false;
            let closeSignal = function (local, remote) {
                if (local) localDone = true;
                if (remote) remoteDone = true;
                if (localDone && remoteDone) ws.close();
            }

            // Reconnect to Signal and restart WebRTC connection
            const reconnect = function () {
                // Set connected to false
                connected = false;

                // Reconnect after 3 seconds
                clearTimeout(reconnectId);
                reconnectId = setTimeout(() => {
                    if (connected) return;
                    console.debug("reconnect");
                    that.connect(addr, login, server);
                }, "3000");
            };

            // On connected to WebRTC server
            const onconnected = function (_, dc) {
                console.debug("onconnected");

                // Send dc ping every 3 min
                const pingTimeout = 3 * 60 * 1000;
                let lastGetTime = Date.now();
                var timeoutID;

                // Check get dc message timeout and send ping if not received
                const checkPing = function () {
                    // Check ping after timeout
                    let checkAfter;

                    // Send ping if not received message for 3 min
                    if (Date.now() - lastGetTime > pingTimeout) {
                        that.sendCmd("ping");
                        checkAfter = pingTimeout;
                    } else {
                        checkAfter = pingTimeout - (Date.now() - lastGetTime);
                    }

                    // Check ping after 1 second
                    timeoutID = setTimeout(() => { checkPing(); }, checkAfter);
                };
                checkPing();

                dc.onopen = () => {
                    console.debug("dc.onopen");
                    if (onopen) onopen();
                    connected = true;
                };

                dc.onclose = (event) => {
                    console.debug("dc.onclose, event:", event);
                    clearTimeout(timeoutID);
                    that.dc = null;
                    dc.close();

                    if (onclose) onclose(true);
                    if (autoReconnect) reconnect();
                };

                dc.onmessage = (ev) => {
                    // The ev.data got bytes array, so convert it to string and pare to
                    // gw object. Then base64 decode gw.data to string
                    // console.debug(ev.data);

                    // Get last message time
                    lastGetTime = Date.now();

                    const atob_utf8 = function (value) {
                        const value_latin1 = atob(value);
                        return new TextDecoder('utf-8').decode(
                            Uint8Array.from(
                                { length: value_latin1.length },
                                (element, index) => value_latin1.charCodeAt(index)
                            )
                        )
                    }

                    const exec = function (msg) {
                        let obj = JSON.parse(msg);
                        console.debug(
                            "dc.got  command:", obj.command + ",",
                            "data_length:", (obj.data == null ? 0 : obj.data.length) + ",",
                            "id:", obj.id,
                        );
                        let data = null;
                        if (obj.data) {
                            data = atob_utf8(obj.data);
                        }
                        m.execAll(obj, data);
                    }

                    // Process Blob
                    if (ev.data instanceof Blob) {
                        ev.data.text().then(msg => exec(msg));
                        return;
                    }
                    // Process ArrayBuffer
                    exec(new TextDecoder().decode(ev.data));
                };
            };

            // Send signal to signal server
            const sendSignal = function (signal) {
                let s = JSON.stringify(signal);
                try {
                    ws.send(s);
                } catch (e) {
                    console.debug("send ws signal error:", e);
                    reconnect();
                    return;
                }

                console.debug("send signal:", s)
            };

            // Process signal commands
            const processSignal = function () {

                console.debug("connect to:", addr);
                ws = new WebSocket(addr);

                // on websocket open
                ws.onopen = function (ev) {
                    console.debug("ws.onopen");
                    console.debug("send login", login);
                    sendSignal({ signal: "login", login: login });
                }

                // on websocket error
                ws.onerror = function (ev) {
                    console.debug("ws.onerror");
                    ws.close();
                    reconnect();
                }

                // on websocket close
                ws.onclose = function (ev) {
                    console.debug("ws.onclose");
                }

                // on websocket message
                ws.onmessage = function (ev) {
                    let obj = JSON.parse(ev.data);

                    switch (obj['signal']) {
                        case "login":
                            console.debug("got login answer signal", obj);
                            processWebrtc();
                            break;

                        case "answer":
                            console.debug("got answer to offer signal", obj.data);
                            let answer = obj.data;
                            pc.setRemoteDescription(answer);
                            break;

                        case "candidate":
                            console.debug("got candidate signal", obj.data);
                            if (obj.data == null) {
                                console.debug("all remote candidate processed");
                                closeSignal(false, true);
                                break;
                            }

                            // Add remote ICE candidate
                            const candidate = new RTCIceCandidate(obj.data);
                            pc.addIceCandidate(candidate);
                            // .then(
                            //     function () { console.debug("ok, state:", pc.iceConnectionState); },
                            //     function (err) { console.debug("error:", err); }
                            // );
                            break;

                        default:
                            console.debug("Wrong signal received, ev:", ev);
                            ws.close();
                            pc.close();
                            reconnect();
                            break;
                    }
                }
            };

            // processWebrtc process webrtc commands
            processWebrtc = function () {

                // Connect to webrtc server
                const configuration = {
                    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
                };
                pc = new RTCPeerConnection(configuration);
                const dc = pc.createDataChannel("teo");

                // Show signaling state
                pc.onsignalingstatechange = function (ev) {
                    console.debug("signaling state change:", pc.signalingState)
                    if (pc.signalingState == "stable") {
                        // ...
                    }
                };

                // Send local ice candidates to the remote peer
                pc.onicecandidate = function (ev) {
                    if (ev.candidate) {
                        const candidate = ev.candidate;
                        console.debug("send candidate:", candidate);
                        sendSignal({ signal: "candidate", peer: server, data: candidate });
                    } else {
                        console.debug("collection of local candidates is finished");
                        sendSignal({ signal: "candidate", peer: server, data: null });
                        closeSignal(true, false);
                    }
                };

                // Show ice connection state
                pc.oniceconnectionstatechange = function (ev) {
                    console.debug("ICE connection state change:", pc.iceConnectionState);
                    switch (pc.iceConnectionState) {

                        // When the connection is established
                        case "connected":
                            console.debug("time since start:", Date.now() - startTime, "ms", pc);
                            that.dc = dc;
                            onconnected(server, dc);
                            break;

                        // When the connection is closed
                        case "disconnected": {
                            const rec = !connected && autoReconnect;
                            console.debug("disconnected rec:", rec, pc);

                            pc.close(); // The close pc call dc.onclose and reconnect
                            pc = null; // Kill pc object and all links to it

                            if (rec) reconnect();
                            break;
                        }
                    }
                };

                // Let the "negotiationneeded" event trigger offer generation.
                pc.onnegotiationneeded = async () => {
                    try {
                        let offer = await pc.createOffer();
                        pc.setLocalDescription(offer);
                        console.debug("send offer");
                        sendSignal({ signal: "offer", peer: server, data: offer });
                    } catch (err) {
                        console.error(err);
                    }
                };

                pc.ondatachannel = function (ev) {
                    console.debug("on data channel", ev)
                };

                return pc;
            };

            processSignal();
        },

        /** Send message to WebRTC server */
        send: function (msg) {
            if (this.dc) {
                let obj = JSON.parse(msg);
                try {
                    this.dc.send(msg);
                    console.debug(
                        "dc.send command:", obj.command + ",",
                        "data_length:", (obj.data == null ? 0 : obj.data.length) + ",",
                        "id:", obj.id,
                    );
                } catch (err) {
                    console.debug("dc.send error:", err);
                }
                return;
            }
            console.error("dc.send error, dc does not exists");
        },

        /** Send request with command and data to WebRTC server */
        sendCmd: function (cmd, cmdData) {

            let btoa_utf8 = function (value) {
                return btoa(
                    String.fromCharCode(
                        ...new TextEncoder('utf-8')
                            .encode(value)
                    )
                );
            }

            let data = null;
            if (cmdData) {
                data = btoa_utf8(cmdData);
            }
            let request = {
                id: rtc_id++,
                address: "",
                command: cmd,
                data: data,
            };
            let msg = JSON.stringify(request);
            this.send(msg);
        },

        /** Close WebRTC data channel if connected */
        close: function (killreaders = false) {
            console.debug("pc.close");
            if (this.connected()) {
                if (killreaders) {
                    m.delAll();
                }
                this.dc.close();
                this.dc = null;
                // connected = false;
            }
        },
    };

    // Websocket server methods
    const serverWebsocket = {

        teo: null,
        server: "",
        login: "",

        /**
         * Connect to Teonet Websocket proxy server
         * 
         * @param {string} addr the WebRTC signal server address
         * @param {string} login this web application name
         * @param {string} server server name
         * @param {bool} auto reconnect when connection to server is lost
         */
        connect: function (addr, login, server, autoReconnect = true) {

            console.debug("websocket teoweb.connect started ver. " + version);

            const that = this;
            const startTime = Date.now();

            // Create TeoProxy client object
            const teo = new TeoProxyClient();
            this.server = server;
            this.login = login;
            this.teo = teo;
            this.dc = {};

            // Reconnect to Signal and restart WebRTC connection
            const reconnect = function () {
                connected = false;

                // teo.socket && teo.socket.close();
                teo.socket = null;
                setTimeout(() => {
                    console.debug("reconnect(ws)");
                    that.connect(addr, login, server);
                }, "3000");
            };

            // Connect to Teonet proxy websocket and Teonet peer api.
            teo.connect(addr, server, function () {
                console.debug("websocket onopen");
            });

            // On connection closed
            teo.onclose = () => {
                console.debug("websocket onclose");

                // Call onclose callback
                if (onclose) onclose(true);
                // connected = false;

                // Reconnect
                if (autoReconnect) reconnect();
            }

            // On message received from Teonet peer
            teo.onmessage = (pac) => {

                // Print received packet
                const logMsg = (pac, gw) => console.debug(
                    "ws.got  command:", (gw ? gw.command : "") + ",",
                    "data_length:", (pac.data == null ? 0 : pac.data.length) + ",",
                    "id:", pac.id + (pac.err ? ", error: " + pac.err : ""),
                );

                // Got Connect answer with success
                if (pac.cmd == Command.ConnectTo && !pac.err) {
                    console.debug(pac.data);
                    console.debug("time since start:", Date.now() - startTime, "ms");
                    if (onopen) onopen();
                    connected = true;
                    return;
                }

                // Got Connect answer with error
                if (pac.cmd == Command.ConnectTo && pac.err) {
                    console.error(pac.err);
                    teo.socket && teo.socket.close();
                    return;
                }

                // Got Disconnect from teoproxy with disconnected peer in data
                if (pac.cmd == Command.Disconnect) {
                    console.debug("teonet peer", pac.data, "disconnected");
                    teo.socket && teo.socket.close();
                    return;
                }

                // Get command by packet id
                let gw = {};
                let data = pac.data;
                const cmd = mp.get(pac.id)
                if (!cmd) {
                    // Process subscribed commands

                    // Get command and data from packet data
                    if (pac.data) {
                        const dataArray = pac.data.split("/");
                        const cmdData = dataArray[dataArray.length - 1];
                        const cmdArgs = dataArray.slice(0, dataArray.length - 1).join("/");

                        // Set command and data
                        gw.command = cmdArgs;
                        data = cmdData;
                    }

                } else {
                    // Process answer command

                    // Set command and use pac.data as data
                    gw = cmd();
                    mp.del(pac.id);
                }

                // Set error from packet
                gw.err = pac.err;

                // Check error in data
                if (data && data.startsWith("error: ")) {
                    gw.err = data.substring(7);
                }

                // Check empty data
                if (data === "") {
                    data = null;
                }

                // Print received packet log message
                logMsg(pac, gw);

                // Got SendTo answers, exec commands
                if (pac.cmd == Command.SendTo) {
                    m.execAll(gw, data);
                }
            }
        },

        /** Send request with command and data to WebRTC server */
        sendCmd: function (cmd, data) {

            // Send command
            // console.debug("websocket sendCmd:", cmd, cmdData);
            let cmdData = this.login + "," + cmd;
            if (data) {
                cmdData += "/" + data;
            }
            const id = this.teo.cmd.sendTo(this.server, "cmd", cmdData);

            // Print console debug message
            console.debug(
                "ws.send command:", cmd + ",",
                "data_length:", (data == null ? 0 : data.length) + ",",
                "id:", id,
            );

            // Save to send packets map
            mp.add(() => {
                const gw = { command: cmd }
                return gw;
            }, id);
        },
    };

    // Webtransport server methods
    const serverWebtransport = {

        teo: null,
        server: "",
        login: "",

        /**
         * Connect to Teonet Webtransport server
         * 
         * @param {string} addr not used
         * @param {string} login this web application name
         * @param {string} server teowebtransport server url
         * @param {bool} auto reconnect when connection to server is lost
         */
        connect: function (addr, login, server, autoReconnect = true) {

            console.debug("webtramsport teoweb.connect started ver. " + version);

            const that = this;
            const startTime = Date.now();

            // Create TeoWebTransport object
            const teo = new TeoWebtransport();
            // this.server = server;
            this.login = login;
            this.teo = teo;
            this.dc = {};

            // Connect to server
            teo.connect(
                // Teonet webtransport server url
                addr,

                // On connect callback
                () => {
                    console.debug("webtransport connected");
                    console.debug("time since start:", Date.now() - startTime, "ms");

                    // Call onopen callback
                    if (onopen) onopen();
                    connected = true;
                },

                // On disconnect callback
                (normally) => {
                    console.debug("webtransport disconnected", normally);

                    // Call onclose callback. The reconnect will be called by 
                    // TeoWebtransport if autoReconnect is true
                    if (onclose) onclose(true);
                    connected = false;
                },

                // On message callback
                (msg) => {
                    // Print received packet log message
                    // console.debug("onmessage", msg);

                    // Process received packet and save it like
                    // Teogw packet data:
                    //
                    // type TeogwData struct {
                    // 	ID      uint32 `json:"id"`
                    // 	Address string `json:"address"`
                    // 	Command string `json:"command"`
                    // 	Data    []byte `json:"data"`
                    // 	Err     string `json:"err"`
                    // }
                    const gw = { id: msg.id, command: msg.command };
                    if (msg.err) {
                        gw.err = msg.data;
                    }

                    // Execute readers (send command answer to all readers)
                    m.execAll(gw, msg.data);
                },

                // Auto reconnect flag
                autoReconnect,
            );
        },

        /** Send request with command and data to WebRTC server */
        sendCmd: function (cmd, data) {

            const id = this.teo.sendCmd(cmd, data);

            // Print console debug message
            console.debug(
                "wt.send command:", cmd + ",",
                "data_length:", (data == null ? 0 : data.length) + ",",
                "id:", id,
            );

            // Save to send packets map
            mp.add(() => {
                const gw = { command: cmd }
                return gw;
            }, id);
        }
    };

    // Use WebRTC, Websocket or Webtransport server
    switch (connectType) {
        case "webrtc":
            return Object.assign({}, serverWebRTC, serverCommon);

        case "ws":
            return Object.assign({}, serverWebsocket, serverCommon);

        case "webtransport":
            return Object.assign({}, serverWebtransport, serverCommon);

        default:
            console.error("connectType " + connectType + " is unknown, try webrtc");
            return Object.assign({}, serverWebRTC, serverCommon);
    }
};

// Map for teoweb
function mapCreate() {
    const m = new Map();
    let key = 0;
    return {
        /** Add new element to the map and return key */
        add: function (f, k = ++key) {
            m.set(k, f);
            return k;
        },

        /** Delete element from the map by key */
        del: function (key) {
            m.delete(key);
        },

        /** Delete all elements from the map */
        delAll: function () {
            m.forEach(function (f, key) {
                m.delete(key);
            });
        },

        /** Get element from map by key */
        get: function (key) {
            return m.get(key);
        },

        /** Execute function by key from map */
        exec: function (key, gw, data) {
            const f = m.get(key);
            if (f) f(gw, data);
        },

        /** Execute all functions from map */
        execAll: function (gw, data) {
            m.forEach(function (f/* , key */) {
                f(gw, data);
            });
        }
    }
};

export default teoweb;