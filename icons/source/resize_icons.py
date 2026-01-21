from PIL import Image
import os

# Define the required icon sizes
icon_sizes = {
    "icon16.png": (16, 16),
    "icon32.png": (32, 32),
    "icon48.png": (48, 48),
    "icon128.png": (128, 128),
}

# Path to the source image
source_image = "icon.png"

# Ensure the source image exists
if not os.path.exists(source_image):
    print(f"Error: {source_image} not found in the current directory.")
    exit(1)

# Open the source image
with Image.open(source_image) as img:
    # Ensure the image is in RGBA mode (supports transparency)
    img = img.convert("RGBA")

    # Create resized icons
    for filename, size in icon_sizes.items():
        resized_img = img.resize(size, Image.Resampling.LANCZOS)
        resized_img.save(filename, format="PNG")
        print(f"Saved {filename} with size {size}")

print("All icons have been created successfully!")