import screenshot from 'screenshot-desktop';

export interface ScreenshotResult {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Captures the primary display screenshot.
 * Returns a PNG buffer.
 */
export async function captureScreen(): Promise<ScreenshotResult> {
  try {
    // screenshot-desktop returns a PNG Buffer
    const imgBuffer: Buffer = await screenshot({ format: 'png' });

    // Parse PNG dimensions from the header
    const { width, height } = parsePngDimensions(imgBuffer);

    return { buffer: imgBuffer, width, height };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (
      msg.toLowerCase().includes('permission') ||
      msg.toLowerCase().includes('screen recording') ||
      msg.toLowerCase().includes('screencapture')
    ) {
      throw new Error(
        'Screen Recording permission required.\n\n' +
          'Please go to System Settings → Privacy & Security → Screen Recording\n' +
          'and enable access for Chess Helper Overlay.\n\n' +
          'Then restart the application.'
      );
    }

    throw new Error(`Screenshot capture failed: ${msg}`);
  }
}

/**
 * Parse width and height from a PNG file header.
 * PNG IHDR chunk: bytes 16–19 = width (big-endian), bytes 20–23 = height (big-endian)
 */
function parsePngDimensions(buffer: Buffer): { width: number; height: number } {
  // PNG signature: 8 bytes, then IHDR chunk:
  //   4 bytes length, 4 bytes "IHDR", 4 bytes width, 4 bytes height
  if (buffer.length < 24) {
    throw new Error('Invalid PNG buffer: too short');
  }

  // Check PNG signature
  const sig = buffer.slice(0, 8);
  const expectedSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!sig.equals(expectedSig)) {
    throw new Error('Not a valid PNG buffer');
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  return { width, height };
}

/**
 * Captures a specific display by index (0-based).
 * Useful if multiple monitors are present.
 */
export async function captureDisplay(displayIndex: number): Promise<ScreenshotResult> {
  try {
    const screens = await screenshot.listDisplays();
    if (displayIndex >= screens.length) {
      throw new Error(`Display index ${displayIndex} out of range (${screens.length} displays found)`);
    }

    const imgBuffer: Buffer = await screenshot({
      screen: screens[displayIndex].id,
      format: 'png',
    });

    const { width, height } = parsePngDimensions(imgBuffer);
    return { buffer: imgBuffer, width, height };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Screenshot capture failed for display ${displayIndex}: ${msg}`);
  }
}
