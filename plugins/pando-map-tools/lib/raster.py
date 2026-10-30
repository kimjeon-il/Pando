"""EXIF and alpha conversion still used by the Python training producer."""
from PIL import Image, ImageOps


def oriented_map_image(opened):
    """Apply orientation and composite transparency over white."""
    oriented = ImageOps.exif_transpose(opened).convert('RGBA')
    return Image.alpha_composite(Image.new('RGBA', oriented.size, (255, 255, 255, 255)), oriented)
