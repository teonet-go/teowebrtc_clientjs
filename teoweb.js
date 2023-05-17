'use strict';

const version = "0.0.30";

/**
 * Create teoweb object
 *
 */
function teoweb() {
    const cmdSubscribe = "subscribe";

    // Map for teoweb
    let m = function mapCreate() {
        const m = new Map();
        let key = 0;
        return {
            /** Add new element to the map and return key */
            add: function (f) {
                m.set(++key, f);
                return key;
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
    }();

    let rtc_id = 0;
    let onopen = null;
    let onclose = null;
    let connected = false;

    return {
        /**
         * Connect to Teonet WebRTC server
         * 
         * @param {string} addr the WebRTC signal server address
         * @param {string} login this web application name
         * @param {string} server server name
         */
        connect: function (addr, login, server) {

            console.debug("teoweb.connect started ver. " + version);

            let that = this;
            let processWebrtc;
            let startTime = Date.now();

            // Signal and WebRTC objects
            let ws;
            let pc;

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
            let reconnect = function () {
                setTimeout(() => {
                    console.debug("reconnect");
                    that.connect(addr, login, server);
                }, "3000");
            };

            // On connected to WebRTC server
            let onconnected = function (_, dc) {
                console.debug("dc connected");
                dc.onopen = () => {
                    console.debug("dc open");
                    if (onopen) onopen();
                    connected = true;
                };
                dc.onclose = () => {
                    console.debug("dc close");
                    if (onclose) onclose(true);
                    connected = false;
                };
                dc.onmessage = (ev) => {
                    // The ev.data got bytes array, so convert it to string and pare to
                    // gw object. Then base64 decode gw.data to string
                    // console.debug(ev.data);

                    let exec = function (msg) {
                        let obj = JSON.parse(msg);
                        console.debug("dc.got answer command:", obj.command + ",", "data_length:", obj.data == null ? 0 : obj.data.length);
                        let gw = JSON.parse(msg);
                        const data = atob(gw.data);
                        m.execAll(gw, data);
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

            // On disconnected from WebRTC server
            let ondisconnected = function () {
                console.debug("disconnected");
                if (onclose) onclose();
            };


            // Send signal to signal server
            let sendSignal = function (signal) {
                let s = JSON.stringify(signal);
                ws.send(s)
                console.debug("send signal:", s)
            };

            // Process signal commands
            let processSignal = function () {

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
                let dc = pc.createDataChannel("teo");

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
                        case "connected":
                            let endTime = Date.now()
                            console.debug("time since start:", endTime - startTime, "ms");
                            that.dc = dc;
                            onconnected(server, dc);
                            break;
                        case "disconnected":
                            ondisconnected(server, dc);
                            connected = false;
                            that.dc = null;
                            dc.close();
                            reconnect();
                            break;
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

        /** Set on dc open function */
        onOpen: function (f) {
            onopen = f;
        },

        /** Set on dc or webrtc close function */
        onClose: function (f) {
            onclose = f;
        },

        /** Send message to WebRTC server */
        send: function (msg) {
            if (this.dc) {
                let obj = JSON.parse(msg);
                console.debug("dc.send command:", obj.command + ",", "data_length:", obj.data == null ? 0 : obj.data.length);
                this.dc.send(msg);
            } else {
                console.debug("dc.send error, dc does not exists");
            }
        },

        /** Send request with command and data to WebRTC server */
        sendCmd: function (cmd, cmdData) {
            let data = null;
            if (cmdData) {
                data = btoa(cmdData);
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

        /** Send request with subscribe command to WebRTC server */
        subscribeCmd: function (cmd) {
            this.sendCmd(cmdSubscribe, cmd);
        },

        /** Add reader */
        addReader: function (f) {
            return m.add(f);
        },

        /** Remove reader bye key returned from addReader() function */
        delReader: function (key) {
            m.del(key);
        },

        /** WebRTC datachannel or NULL if not connected */
        dc: null,

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

        /** Users field to save authentication token. Used on client part to 
         * save some unical values */
        token: null,
    }
};

export default teoweb;