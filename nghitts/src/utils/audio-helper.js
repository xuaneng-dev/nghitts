/**
 * Merges multiple WAV Blobs (mono, 16-bit PCM, same sample rate) into a single WAV Blob.
 * This is performed directly on the client side, allowing progressive downloads
 * or recovering partial audio if synthesis fails midway.
 * 
 * @param {Blob[]} blobs - Array of WAV Blobs to merge
 * @returns {Promise<Blob|null>} - Merged WAV Blob or null
 */
export async function mergeWavBlobs(blobs) {
  if (!blobs || blobs.length === 0) return null;
  if (blobs.length === 1) return blobs[0];

  try {
    const buffers = [];
    let totalDataLength = 0;
    
    // Read all blobs as ArrayBuffers and extract PCM data (skip 44 bytes header)
    for (const blob of blobs) {
      const arrayBuffer = await blob.arrayBuffer();
      if (arrayBuffer.byteLength <= 44) continue; // Skip empty/corrupt WAVs
      
      const dataBuffer = arrayBuffer.slice(44);
      buffers.push(dataBuffer);
      totalDataLength += dataBuffer.byteLength;
    }

    if (buffers.length === 0) return null;

    // Create a new ArrayBuffer for the merged WAV (44 bytes header + PCM data)
    const mergedBuffer = new ArrayBuffer(44 + totalDataLength);
    const view = new DataView(mergedBuffer);

    // Read the original header from the first valid WAV blob
    const firstHeaderBuffer = await blobs[0].arrayBuffer();
    
    // Copy the entire 44-byte header structure
    const headerBytes = new Uint8Array(firstHeaderBuffer, 0, 44);
    new Uint8Array(mergedBuffer).set(headerBytes, 0);

    // Update file size in header (byte 4 to 7: 36 + totalDataLength)
    // Formula: Overall Size = 36 + SubChunk2Size (PCM Data Size)
    view.setUint32(4, 36 + totalDataLength, true);

    // Update data chunk length in header (byte 40 to 43: totalDataLength)
    // Formula: SubChunk2Size = NumSamples * NumChannels * BitsPerSample/8
    view.setUint32(40, totalDataLength, true);

    // Copy PCM data from all buffers sequentially
    let offset = 44;
    for (const dataBuffer of buffers) {
      new Uint8Array(mergedBuffer).set(new Uint8Array(dataBuffer), offset);
      offset += dataBuffer.byteLength;
    }

    return new Blob([mergedBuffer], { type: 'audio/wav' });
  } catch (error) {
    console.error('Failed to merge WAV blobs:', error);
    return null;
  }
}
