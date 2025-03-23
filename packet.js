
// Packet class
export class Packet {

    // Packet constructor creates new empty packet.
    constructor(cmd = 0) {
        this.id = 0; // Packet ID - 4 bytes
        this.cmd = cmd; // Command - 1 byte
        this.data = null; // Data - uint8 array
        this.err = null; // Error field (string)
    }

    // Marshal packet into uint8 array.
    marshal() {
        const len = !this.err ? (this.data ? this.data.length : 0) : this.err.length;
        const data = new Uint8Array(4 + 1 + len + 1);

        // Packet ID
        data[0] = this.id & 0xFF;
        data[1] = (this.id >> 8) & 0xFF;
        data[2] = (this.id >> 16) & 0xFF;
        data[3] = (this.id >> 24) & 0xFF;

        // Command
        data[4] = this.cmd;

        // Data or error
        if (this.err !== null) {
            data[4] |= 0x80;
            data.set(new TextEncoder().encode(this.err), 5);
        } else {
            if (this.data) {
                let d = this.data;
                // String to Uint8Array
                if (typeof this.data === "string") {
                    d = new TextEncoder().encode(this.data);
                }
                data.set(d, 5);
            }
        }

        // Add byte checksum
        data[5 + len] = this.checksum(data.slice(0, 5 + len));

        return data;
    }

    // Calculate packet checksum.
    checksum(data) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum += data[i];
            sum &= 0xFF;
        }
        return sum;
    }

    // Unmarshal packet from uint8 array.
    unmarshal(data) {

        // Check packet length
        if (data.length < 5) {
            this.err = "packet too short";
            return;
        }

        // Check packet checksum
        // if (data[data.length - 1] !== this.checksum(data.slice(0, data.length - 1))) {
        //     console.debug("checksum error", data);
        //     this.err = "packet checksum error";
        //     return;
        // }

        data = data.slice(0, data.length - 1)

        // ID
        this.id = data[0].charCodeAt(0) + (data[1].charCodeAt(0) << 8) +
            (data[2].charCodeAt(0) << 16) + (data[3].charCodeAt(0) << 24);

        // Command
        this.cmd = data[4].charCodeAt(0);

        // Data
        if (this.cmd & 0x80) {
            this.cmd &= 0x7F;
            this.err = data.slice(5);
        } else {
            this.data = data.slice(5);
        }
    }

    // Encode packet into base64 string.
    encode() {
        return this.uint8ArrayToBase64(this.marshal());
    }

    // Decode base64 string into packet.
    decode(data) {
        this.unmarshal(atob(data));
    }

    // Convert uint8Array to base64 string.
    uint8ArrayToBase64(bytes) {
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

}

export default Packet