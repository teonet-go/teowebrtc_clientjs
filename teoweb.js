'use strict';

const version = "0.0.21";

/**
 * Create teoweb object
 *
 */
function teoweb() {
    return {
        /**
         * Connect to Teonet WebRTC server
         * 
         * @param {string} addr the WebRTC signal server address
         * @param {string} login this web application name
         * @param {string} server server name
         * @param {function(peer, dc)} connected function called when connected
         */
        connect: function (addr, login, server, connected) {

            console.debug("teoweb.connect started ver. " + version);

            if (connected) {
                this.onconnected = connected;
            }

            let that = this;
            let processWebrtc;
            let startTime = Date.now();

            // Signal and WebRTC objects
            var ws;
            var pc;

            var reconnect = function () {
                setTimeout(() => {
                    console.debug("reconnect");
                    that.connect(addr, login, server, that.onconnected);
                }, "3000");
            };

            // sendSignal send signal to signal server
            var sendSignal = function (signal) {
                var s = JSON.stringify(signal)
                ws.send(s)
                console.debug("send signal:", s)
            };

            // processSignal process signal commands
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
                var dc = pc.createDataChannel("teo");

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
                            that.onconnected(server, dc);
                            break;
                        case "disconnected":
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
        onconnected: function () { },
        send: function (msg) {
            if (this.dc) {
                console.debug("dc.send msg:", msg);
                this.dc.send(msg);
            } else {
                console.debug("dc.send error, dc does not exists");
            }
        },
        dc: null,
    }
};

export default teoweb;