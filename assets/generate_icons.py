import os
import cairosvg
from PIL import Image
import icnsutil

def svg_to_png(svg_path, png_path, size):
    cairosvg.svg2png(url=svg_path, write_to=png_path, output_width=size, output_height=size)

def create_ico(png_paths, ico_path):
    imgs = []
    for png_path in png_paths:
        img = Image.open(png_path)
        imgs.append(img)
    
    # The first image in the list will be used as the default icon
    imgs[0].save(ico_path, format='ICO', sizes=[(img.width, img.height) for img in imgs])

def create_icns(png_paths, icns_path):
    icns = icnsutil.IcnsFile()
    size_to_type = {
        16: 'icp4',
        32: 'icp5',
        64: 'icp6',
        128: 'ic07',
        256: 'ic08',
        512: 'ic09',
        1024: 'ic10'
    }
    for png_path in png_paths:
        size = Image.open(png_path).width
        if size in size_to_type:
            icns.add_media(size_to_type[size], file=png_path)
    icns.write(icns_path)

def generate_icons(svg_file, output_dir):
    base_name = os.path.splitext(os.path.basename(svg_file))[0]
    sizes = [16, 32, 64, 128, 256, 512, 1024]

    # Generate PNGs
    png_paths = []
    for size in sizes:
        png_path = os.path.join(output_dir, f"{base_name}-{size}.png")
        svg_to_png(svg_file, png_path, size)
        png_paths.append(png_path)

    # Create ICO for Windows
    ico_path = os.path.join(output_dir, f"{base_name}.ico")
    create_ico(png_paths[:4], ico_path)  # Use sizes up to 128 for ICO

    # Create ICNS for macOS
    icns_path = os.path.join(output_dir, f"{base_name}.icns")
    create_icns(png_paths, icns_path)

if __name__ == "__main__":
    svg_files = ["tray-icon.svg", "tray-icon-recording.svg"]
    output_dir = "assets"

    os.makedirs(output_dir, exist_ok=True)

    for svg_file in svg_files:
        generate_icons(svg_file, output_dir)

    print("Icon generation complete!")