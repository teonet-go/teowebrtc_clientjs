// Include Packet class
import Packet from "./packet.js";

// Available commands.
export const Command = {
    cmdNone: 0, // No command
    Connect: 1, // Connect to Teonet
    Disconnect: 2, // Disconnect from Teonet
    ConnectTo: 3, // Connect to peer
    NewApiClient: 4, // New API client
    SendTo: 5, // Send API request
    Sream: 6, // Stream command to get data from peer
    cmdCount: 7
};

//* Teonet proxy client class */
class TeoProxyClient {

    id = 0;

    //* Teonet proxy client */
    constructor() {
        this.socket = null;
        this.onclose = null;
        this.onmessage = null;
        this.cmd = this.makeCommands(this);
    }

    /** Connect to Teonet proxy websocket and Teonet peer api. */
    connect(wsname, peer, onopen = null) {
        this.connectWs(wsname, () => {
            this.cmd.connect();
            this.cmd.connectTo(peer);
            this.cmd.newApiClient(peer);
            if (onopen) onopen();
        })
    }

    // Connect to Teonet proxy websocket server.
    connectWs(name, onopen = null) {
        let url = "wss://" + name + "/ws";
        console.debug("connect to websocket:", url)
        this.socket = new WebSocket(url);

        this.socket.onopen = function (evt) {
            if (onopen) onopen();
        }

        this.socket.onclose = (event) => {
            if (this.onclose) this.onclose(event);
        }

        this.socket.onmessage = (event) => {
            if (this.onmessage) {
                let pac = new Packet();
                pac.decode(event.data);
                this.onmessage(pac);
            }
        }
    }

    // Send packet to Teonet proxy websocket server.
    send(pac) {
        if (!this.socket) {
            return;
        }
        console.debug("send", pac);
        this.socket.send(pac.encode());
    }

    // Make commands
    makeCommands(that) {

        return {
            // Send connect to Teonet command.
            connect: function () {
                let pac = new Packet(Command.Connect);
                that.send(pac);
            },

            // Send disconnect from Teonet command.
            disconnect: function () {
                let pac = new Packet(Command.Disconnect);
                that.send(pac);
            },

            // Send connect to peer command.
            connectTo: function (name) {
                let pac = new Packet(Command.ConnectTo);
                pac.data = name;
                that.send(pac);
            },

            // Send new API client command.
            newApiClient: function (name) {
                let pac = new Packet(Command.NewApiClient);
                pac.data = name;
                that.send(pac);
            },

            /** Send message to peer. */
            sendTo: function (name, cmd, data) {
                let pac = new Packet(Command.SendTo);
                pac.id = that.nextId();
                pac.data = name;
                pac.data += "," + cmd + "," + data;
                that.send(pac);
                return pac.id;
            },

            /** Create answer socket */
            stream: function (name, stream) {
                let pac = new Packet(Command.Sream);
                pac.data = name + "," + stream;
                that.send(pac);
             }
        }
    }

    // Generate next packet id.
    nextId() {
        if (++this.id > 0xFFFFFFFF) {
            this.id = 1;
        }
        return this.id;
    }
}

export default TeoProxyClient
