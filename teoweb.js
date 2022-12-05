/**
 * Teonet web application client class
 * 
 * @param {Object} ws Websocket connection
 * @param function name(peer, dc) connected
 * @returns 
 */
function TeoConnect(addr, login, server, connected) {

    let startTime = Date.now();
    console.log("TeoConnect started v 1");

    // Connect to signal server
    var ws = new WebSocket(addr);
    var pc;

    // WebRTC server name
    // var offer;
    // var pc;

    // sendSignal send signal to signal server
    sendSignal = function (signal) {
        var s = JSON.stringify(signal)
        ws.send(s)
        console.log("send signal:", s)
    };

    // processSignal process signal commands
    processSignal = function () {

        // var pc;

        // on websocket open
        ws.onopen = function (ev) {
            console.log("ws.onopen");
            console.log("send login", login);
            sendSignal({ signal: "login", login: login });
        }
        // on websocket error
        ws.onerror = function (ev) {
            console.log("ws.onerror");
        }
        // on websocket close
        ws.onclose = function (ev) {
            console.log("ws.onclose");
        }
        // on websocket message
        ws.onmessage = function (ev) {
            obj = JSON.parse(ev.data);

            switch (obj['signal']) {
                case "login":
                    console.log("got login answer signal", obj);
                    processWebrtc();
                    break;

                case "answer":
                    console.log("got answer to offer signal", obj.data);
                    let answer = obj.data;
                    pc.setRemoteDescription(answer);
                    break;

                case "candidate":
                    console.log("got candidate signal", obj.data);
                    if (obj.data == null) {
                        console.log("all remote candidate processed");
                        break;
                    }
                    // Add remote ICE candidate

                    const candidate = new RTCIceCandidate(obj.data);

                    pc.addIceCandidate(candidate);
                    // .then(
                    //     function () { console.log("ok, state:", pc.iceConnectionState); },
                    //     function (err) { console.log("error:", err); }
                    // );
                    break;

                default:
                    console.log("Wrong signal received, ev:", ev);
                    break;
            }
        }
    };

    // processWebrtc process webrtc commands
    processWebrtc = function () {

        // Connect to webrtc server
        const configuration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
        pc = new RTCPeerConnection(configuration);
        var dc = pc.createDataChannel("teo");

        // Show signaling state
        pc.onsignalingstatechange = function (ev) {
            console.log("signaling state change:", pc.signalingState)
            if (pc.signalingState == "stable") {
                // ...
            }
        };

        // Send local ice candidates to the remote peer
        pc.onicecandidate = function (ev) {
            if (ev.candidate) {
                candidate = ev.candidate;
                console.log("send candidate:", candidate);
                sendSignal({ signal: "candidate", peer: server, data: candidate });
            } else {
                console.log("collection of local candidates is finished");
                sendSignal({ signal: "candidate", peer: server, data: null });
            }
        };

        // Show ice connection state
        pc.oniceconnectionstatechange = function (ev) {
            console.log("ICE connection state change:", pc.iceConnectionState);
            switch (pc.iceConnectionState) {
                case "connected":
                    let endTime = Date.now()
                    console.log("time since start:", endTime - startTime, "ms");
                    connected(server, dc);
                    break;
                case "disconnected":
                    dc.close();
                    break;
            }
        };

        // Let the "negotiationneeded" event trigger offer generation.
        pc.onnegotiationneeded = async () => {
            try {
                let offer = await pc.createOffer();
                pc.setLocalDescription(offer);
                console.log("send offer");
                sendSignal({ signal: "offer", peer: server, data: offer });
            } catch (err) {
                console.error(err);
            }
        };

        pc.ondatachannel = function (ev) {
            console.log("on data channel", ev)
        };

        // let dcClosed = false;
        // dc.onopen = function () {
        //     let endTime = Date.now()
        //     console.log("dc.onopen, time since start:", endTime - startTime, "ms");
        //     let id = 0;
        //     sendMsg = function () {
        //         id++;
        //         let msg = "Hello from " + login + " with id " + id;
        //         console.log("send:", msg)
        //         dc.send(msg);
        //         setTimeout(() => {
        //             if (dcClosed) {
        //                 return;
        //             }
        //             sendMsg();
        //         }, "5000")
        //     }
        //     sendMsg();
        // }

        // dc.onclose = function () {
        //     console.log("dc.onclose");
        //     dcClosed = true;
        // }

        // dc.onmessage = function (ev) {
        //     var enc = new TextDecoder("utf-8");
        //     console.log("get:", enc.decode(ev.data));
        // }

        return pc;
    };

    processSignal();

    return {

        /**
          * Send login command signal server
          *  
          * @param {string} addr Name of this client
          * @returns {undefined}
          */
        // login: function (addr) {
        //     ws.send('{ "signal": "login", "login": "' + addr + '" }');
        // },

    };
};
