from PIL import Image, ImageDraw, ImageFont
import math
import os

# --- Config ---
TEXT = "dicotic"
WIDTH, HEIGHT = 800, 200
BG_COLOR = (10, 10, 10)
FPS = 20
DURATION_SEC = 3          # length of “writing” animation
FRAMES = int(FPS * DURATION_SEC)
OUTPUT = "dicotic_rainbow.gif"

# Try some reasonable fonts; update this path if you want a specific font
def get_font(size):
    # Try some cursive/script fonts first
    possible = [
        "/System/Library/Fonts/Supplemental/Brush Script.ttf",
        "/System/Library/Fonts/Supplemental/SnellRoundhand.ttc",
        "/System/Library/Fonts/Supplemental/Zapfino.ttf",
        "/System/Library/Fonts/Supplemental/Apple Chancery.ttf",
    ]
    for path in possible:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass

    # Fallbacks if none of the above work
    fallback = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for path in fallback:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass

    return ImageFont.load_default()

def rainbow_color(t):
    # t in [0,1] -> RGB rainbow
    r = int(127 * (math.sin(2 * math.pi * (t)) + 1))
    g = int(127 * (math.sin(2 * math.pi * (t + 1/3)) + 1))
    b = int(127 * (math.sin(2 * math.pi * (t + 2/3)) + 1))
    return (r, g, b)

def main():
    # Base image for text size measurement
    base = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(base)

    # Choose font size so text fits nicely
    font_size = 120
    font = get_font(font_size)
    text_bbox = draw.textbbox((0, 0), TEXT, font=font)
    text_w = text_bbox[2] - text_bbox[0]
    text_h = text_bbox[3] - text_bbox[1]

    # Extra padding for script/italic fonts that draw below the reported bbox
    pad_top = int(text_h * 0.15)
    pad_bottom = int(text_h * 0.55)
    text_x = (WIDTH - text_w) // 2
    text_y = (HEIGHT - text_h) // 2

    # Gradient band extends above/below bbox so descenders get rainbow color
    grad_y1 = max(0, text_y - pad_top)
    grad_y2 = min(HEIGHT, text_y + text_h + pad_bottom)

    # --- Build a "stroke order" so the text is written along its curves ---
    # Full text mask (all letters)
    mask = Image.new("L", (WIDTH, HEIGHT), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.text((text_x, text_y), TEXT, font=font, fill=255)
    mask_px = mask.load()

    # BFS over text pixels to get an approximate drawing order that
    # follows the connected curves instead of a rectangular wipe.
    from collections import deque

    dist = [[-1] * WIDTH for _ in range(HEIGHT)]
    q = deque()

    # Seed: all foreground pixels in the leftmost column that contains text
    min_x = WIDTH
    for x in range(WIDTH):
        if any(mask_px[x, y] > 0 for y in range(HEIGHT)):
            min_x = x
            break

    for y in range(HEIGHT):
        if mask_px[min_x, y] > 0:
            dist[y][min_x] = 0
            q.append((min_x, y))

    directions = [
        (-1, 0), (1, 0), (0, -1), (0, 1),
        (-1, -1), (-1, 1), (1, -1), (1, 1),
    ]

    max_dist = 0
    while q:
        x, y = q.popleft()
        d = dist[y][x]
        if d > max_dist:
            max_dist = d
        for dx, dy in directions:
            nx, ny = x + dx, y + dy
            if 0 <= nx < WIDTH and 0 <= ny < HEIGHT:
                if mask_px[nx, ny] > 0 and dist[ny][nx] == -1:
                    dist[ny][nx] = d + 1
                    q.append((nx, ny))

    # Bucket pixels into animation frames according to their distance
    frame_bins = [[] for _ in range(FRAMES)]
    if max_dist == 0:
        # Degenerate, but keep it simple: draw everything in first frame
        frame_bins[0] = [
            (x, y)
            for y in range(HEIGHT)
            for x in range(WIDTH)
            if mask_px[x, y] > 0
        ]
    else:
        for y in range(HEIGHT):
            for x in range(WIDTH):
                d = dist[y][x]
                if d >= 0:
                    idx = int((d / max_dist) * (FRAMES - 1))
                    frame_bins[idx].append((x, y))

    # Prepare write mask that we incrementally fill as the "pen" moves
    write_mask = Image.new("L", (WIDTH, HEIGHT), 0)
    write_px = write_mask.load()

    frames = []

    for frame_index in range(FRAMES):
        # Add new pixels for this step of the stroke
        for x, y in frame_bins[frame_index]:
            write_px[x, y] = mask_px[x, y]

        # Main RGB image
        img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)

        # Rainbow gradient across the full text width
        gradient = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
        grad_draw = ImageDraw.Draw(gradient)
        for x in range(text_x, text_x + text_w):
            t = (x - text_x) / max(1, text_w - 1)
            color = rainbow_color(t)
            grad_draw.line([(x, grad_y1), (x, grad_y2)], fill=color)

        # Apply current stroke mask so only already-"written" pixels show
        img = Image.composite(gradient, img, write_mask)

        frames.append(img)

    # Hold final frame a bit longer by duplicating it
    hold_frames = 10
    frames.extend([frames[-1]] * hold_frames)

    frames[0].save(
        OUTPUT,
        save_all=True,
        append_images=frames[1:],
        duration=int(1000 / FPS),
        loop=0,
        disposal=2,
    )

    print(f"Saved {OUTPUT}")

if __name__ == "__main__":
    main()