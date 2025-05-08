
// Delay function
Promise.delay = time_ms => new Promise(resolve => setTimeout(resolve, time_ms));

class TeoWebtransport {

    /**
     * Constructor for TeoWebtransport.
     *
     * Initialize the object:
     * - Set id to 0.
     * - Set writer to null.
     * - Create new TextEncoder and TextDecoder.
     */
    constructor() {
        this.id = 0;
        this.writer = null;
        this.transport = null;

        // Text encoder and decoder
        this.encoder = new TextEncoder();
        this.decoder = new TextDecoder();
    }

    /** Service fields length in teowebtransport message. */
    #serviceFieldsLength = 4 + 4 + 1;

    /**
     * Encode a message into a Uint8Array, prefixing it with a 4-byte length.
     * 
     * @param {string} data
     * @return {Uint8Array}
     */
    #encodeMessage(id, command, data, err = 0) {

        // Encode command
        const commandEncoded = this.encoder.encode(command);
        const commandLength = commandEncoded.length;

        // Encode data
        const dataEncoded = this.encoder.encode(data);
        const dataLength = dataEncoded.length;

        // Calculate message length and create buffer
        const length = commandLength + dataLength + this.#serviceFieldsLength;
        const buffer = new Uint8Array(4 + length);

        // Length of the message in 4 bytes
        buffer[0] = (length >>> 24) & 0xff;
        buffer[1] = (length >>> 16) & 0xff;
        buffer[2] = (length >>> 8) & 0xff;
        buffer[3] = length & 0xff;

        // ID of the message in 4 bytes
        buffer[4] = (id >>> 24) & 0xff;
        buffer[5] = (id >>> 16) & 0xff;
        buffer[6] = (id >>> 8) & 0xff;
        buffer[7] = id & 0xff;

        // Message data length in 4 bytes
        buffer[8] = (dataLength >>> 24) & 0xff;
        buffer[9] = (dataLength >>> 16) & 0xff;
        buffer[10] = (dataLength >>> 8) & 0xff;
        buffer[11] = dataLength & 0xff;

        // Message command
        buffer.set(commandEncoded, 12);

        // Message data
        if (dataLength > 0) {
            buffer.set(dataEncoded, 12 + commandLength);
        }

        // Message error
        buffer[12 + commandLength + dataLength] = err;

        return buffer;
    }

    /**
     * Get and decode entire message from buffer.
     * 
     * @param {Uint8Array} buffer
     * @return {null|{message: Uint8Array, newBuffer: Uint8Array}}
     */
    #getMessageFromBuffer(buffer) {
        // Not enough data in the buffer to read the 4-byte message length
        if (buffer.length < 4) {
            return null;
        }

        // Extract the 4-byte message length from the buffer
        const messageLength = buffer[0] << 24 | buffer[1] << 16 | buffer[2] << 8 | buffer[3];

        // Not enough data in the buffer to read the message
        if (buffer.length < 4 + messageLength) {
            return null;
        }

        // Extrract the message ID from the buffer
        const id = buffer[4] << 24 | buffer[5] << 16 | buffer[6] << 8 | buffer[7];

        // Extract the message data length from the buffer
        const dataLength = buffer[8] << 24 | buffer[9] << 16 | buffer[10] << 8 | buffer[11];

        const commandLength = messageLength - dataLength - this.#serviceFieldsLength;

        // Extract the message command from the buffer
        const command = this.decoder.decode(buffer.slice(12, 12 + commandLength));

        // Extract the message data from the buffer
        let dataArray = new Uint8Array(0);
        if (dataLength > 0) {
            dataArray = buffer.slice(12 + commandLength, 12 + commandLength + dataLength);
        }
        const data = this.decoder.decode(dataArray);

        // Extract the message error from the buffer
        const err = buffer[12 + commandLength + dataLength];

        // Extract the remaining data from the buffer
        const newBuffer = buffer.slice(4 + messageLength);
        // const message = data;

        return { msg: { id, command, data, dataArray, err }, newBuffer };
    }

    /**
     * Reads data from a ReadableStream and save data to buffer. If there is 
     * entire message in buffer than calls a callback function with the data.
     * 
     * @param {ReadableStream} stream
     * @param {string} errorText
     * @param {function(Uint8Array):void} dataReceivedFunction
     * @return {Promise<void>}
     */
    async #messageReader(stream, errorText, dataReceivedFunction) {
        try {
            let buffer = new Uint8Array(0);
            let reader = stream.getReader();
            while (true) {
                // Read data from stream
                const data = await reader.read();
                if (data.done) {
                    break;
                }

                // Add received data to the end of buffer
                const newBuffer = new Uint8Array(buffer.length + data.value.length);
                newBuffer.set(buffer);
                newBuffer.set(data.value, buffer.length);
                buffer = newBuffer;

                // Get messages from buffer
                getFromBuffer:
                while (true) {
                    const data = this.#getMessageFromBuffer(buffer);
                    if (data === null) {
                        break getFromBuffer;
                    }
                    buffer = data.newBuffer;
                    dataReceivedFunction(data.msg);
                }
            }
        } catch (error) {
            console.log(errorText + ':', error);
        }
    };

    /**
     * Reads data from a ReadableStream and calls a callback function with the data.
     * 
     * @param {ReadableStream} stream
     * @param {string} errorText
     * @param {function(Uint8Array):void} dataReceivedFunction
     * @return {Promise<void>}
     */
    async #streamReader(stream, errorText, dataReceivedFunction) {
        try {
            // Get a reader for the stream
            let reader = stream.getReader();

            // Read data from the stream until it is closed
            while (true) {
                // Read a chunk from the stream
                const data = await reader.read();

                // If the chunk is the end of the stream, break out of the loop
                if (data.done) {
                    break;
                }

                // Call the callback function with the chunk
                dataReceivedFunction(data.value);
            }
        } catch (error) {
            // Log any errors that occur
            console.log(errorText + ':', error);
        }
    };

    /**
     * Tries to connect to the WebTransport server. If the connection fails, it
     * will retry every 3 seconds.
     *
     * When connected, it will call the onconnect callback.
     *
     * When disconnected, it will call the ondisconnect callback.
     *
     * When a message is received, it will call the onmessage callback.
     *
     * @param {string} url - The URL of the WebTransport server
     * @param {function} onconnect - The callback to call when the connection is
     *   established
     * @param {function} ondisconnect - The callback to call when the connection
     *   is closed
     * @param {function} onmessage - The callback to call when a message is
     *   received
     * @return {Promise<void>}
     */
    async #run(url, onconnect, ondisconnect, onmessage, autoreconnect) {

        // Connect to WebTransport server
        console.log('connecting to teowebtransport server...');
        const transport = new WebTransport(url);
        this.transport = transport;
        await transport.ready;

        // When the connection is closed
        transport.closed
            .then(() => {
                console.log('connection closed normally')
                if (ondisconnect) ondisconnect(true);
            })
            .catch(err => {
                console.log('connection closed abruptly', err);
                if (ondisconnect) ondisconnect();
                if (autoreconnect) {
                    this.connect(url, onconnect, ondisconnect, onmessage, autoreconnect);
                }
            });

        // Create client-initiated bidi stream & writer
        let stream = await transport.createBidirectionalStream();
        let writer = stream.writable.getWriter();
        this.writer = writer;

        // Display incoming data on bidi stream (messages mode)
        this.#messageReader(stream.readable, 'bidi stream receive error', msg => {
            if (msg.err) {
                console.log('received on bidi stream, error:', msg.data);
                return;
            }
            console.log("wt.got  command:", msg.command + ",", "data len:", msg.data.length);

            if (onmessage) onmessage(msg);
        });

        // Display incoming bidi stream and data on those stream (when stream created by server)
        this.#streamReader(transport.incomingBidirectionalStreams, 'incoming bidi stream error', stream => {
            // console.log('Received an incoming bidi stream');
            let incomingBidiWriter = stream.writable.getWriter();
            this.#streamReader(stream.readable, 'incoming bidi stream receive error', async data => {
                let text = this.decoder.decode(data);
                // console.log('Received on incoming bidi stream:', text);
                await incomingBidiWriter.write(this.encoder.encode(text.toUpperCase()));
                if (onconnect) onconnect();
            });
        });
    }

    /**
     * Tries to connect to the WebTransport server. If the connection fails, it
     * will retry every 3 seconds.
     *
     * When connected, it will call the onconnect callback.
     *
     * When disconnected, it will call the ondisconnect callback.
     *
     * When a message is received, it will call the onmessage callback.
     *
     * @param {string} url - The URL of the WebTransport server
     * @param {function} onconnect - The callback to call when the connection is
     *   established
     * @param {function} ondisconnect - The callback to call when the connection
     *   is closed
     * @param {function} onmessage - The callback to call when a message is
     *   received
     */
    connect(url, onconnect, ondisconnect, onmessage, autoreconnect = true) {
        this.#run(url, onconnect, ondisconnect, onmessage, autoreconnect).catch((err) => {
            console.error("can't connect:", err);
            setTimeout(() => {
                this.connect(url, onconnect, ondisconnect, onmessage, autoreconnect);
            }, 3000);
        })
    };

    /**
     * Sends a command to the WebTransport server. The command should be a string,
     * and the data should be a Uint8Array.
     *
     * @param {string} cmd - The command to send
     * @param {Uint8Array} [data] - The data to send with the command
     * @return {Promise<void>}
     */
    sendCmd(cmd, data = new Uint8Array(0)) {
        // Send the command and data to the WebTransport server
        console.log("wt.send command:", cmd + ",", "data len:", data?.length);
        const id = this.id++;
        this.writer.write(this.#encodeMessage(this.id++, cmd, data));
        return id;
    };

    async close() {
        await this.writer.close();
        this.transport.close();
    };
}

export default TeoWebtransport
