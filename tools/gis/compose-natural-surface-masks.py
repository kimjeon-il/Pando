#!/usr/bin/env python3
"""Offline natural-color composition. No geometry edits or inferred snow lines.

Inputs must already share the DEM grid including gutter. WorldCover is
categorical; glaciers and polar ice are observed fractional coverage masks.
The numerical core/self-test has no optional image/GIS dependency.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

# Restrained cartographic correction, not an alternative physical-land mask.
CLASS_COLORS = {
    10: (77, 130, 81), 20: (153, 168, 105), 30: (161, 184, 112),
    40: (163, 184, 121), 50: (179, 171, 155), 60: (213, 191, 155),
    70: (228, 237, 240), 90: (116, 158, 124), 95: (75, 132, 103),
    100: (154, 165, 140),
}
ICE_COLOR = (239, 244, 247)
CLASS_WEIGHT = 0.22
WATER_SENTINEL = (0, 0, 0, 255)


def coverage(value):
    value = float(value)
    if not math.isfinite(value) or value < 0 or value > 1:
        raise ValueError('Observed mask coverage must be finite and within [0,1]')
    return value


def compose_pixel(rgb, landcover=0, glacier=0, polar=0):
    if len(rgb) < 3 or any(not math.isfinite(float(c)) or c < 0 or c > 255 for c in rgb[:3]):
        raise ValueError('Expected unshaded byte RGB')
    if not isinstance(landcover, int) or isinstance(landcover, bool):
        raise ValueError('WorldCover class must not be interpolated numerically')
    ice = max(coverage(glacier), coverage(polar))
    color = tuple(float(c) for c in rgb[:3])
    if landcover == 80 and ice == 0:
        return WATER_SENTINEL
    if landcover in CLASS_COLORS:
        target = CLASS_COLORS[landcover]
        color = tuple(c * (1-CLASS_WEIGHT) + target[i]*CLASS_WEIGHT for i,c in enumerate(color))
    # Ice replaces pigment, not terrain lighting; hillshade is applied in Viewer.
    color = tuple(c*(1-ice) + ICE_COLOR[i]*ice for i,c in enumerate(color))
    return tuple(min(255,max(0,math.floor(c+0.5))) for c in color) + (255,)


def self_test():
    base=(93,146,79)
    assert compose_pixel(base,0)==base+(255,)
    assert compose_pixel(base,999)==base+(255,)
    assert compose_pixel(base,80)==WATER_SENTINEL
    try:
        compose_pixel(base,10.5)
        raise AssertionError('Fractional category accepted')
    except ValueError:
        pass
    assert compose_pixel(base,10,1,0)==ICE_COLOR+(255,)
    assert compose_pixel(base,60,0,1)==ICE_COLOR+(255,)
    assert compose_pixel(base,70)!=ICE_COLOR+(255,)
    assert compose_pixel(base,80,0,1)==ICE_COLOR+(255,)
    a=compose_pixel(base,0,0.5,0)
    assert all(base[i]<=a[i]<=ICE_COLOR[i] for i in range(3))
    for bad in [-0.1,1.1,float('nan'),float('inf')]:
        try:
            compose_pixel(base,0,bad,0)
            raise AssertionError('Invalid mask accepted')
        except ValueError:
            pass
    assert compose_pixel(base,0,0,0)!=ICE_COLOR+(255,)
    assert base==(93,146,79)
    return {name:True for name in ('unknownPreservesBase','waterSentinelOpaque','classIsNotInterpolated',
        'glacierOverridesLandcover','polarOverridesLandcover','snowClassNotPermanentIce',
        'fractionalMaskIsBounded','invalidMaskRejected','noHeightLatitudeSnowInference','sourceAndOutputSeparate')}


def compose_arrays(rgb, classes, glacier, polar):
    import numpy as np
    if rgb.ndim!=3 or rgb.shape[2]<3 or any(x.shape!=rgb.shape[:2] for x in (classes,glacier,polar)):
        raise ValueError('All inputs must share the exact output grid')
    if classes.dtype.kind not in 'ui':
        raise ValueError('WorldCover categorical grid requires an integer dtype')
    if not np.isfinite(rgb).all() or (rgb<0).any() or (rgb>255).any():
        raise ValueError('Invalid surface RGB')
    for mask in (glacier,polar):
        if not np.isfinite(mask).all() or (mask<0).any() or (mask>1).any():
            raise ValueError('Invalid observed mask coverage')
    output=rgb[...,:3].astype(np.float64)
    for code,color in CLASS_COLORS.items():
        selected=classes==code
        output[selected]=output[selected]*(1-CLASS_WEIGHT)+np.asarray(color)*CLASS_WEIGHT
    ice=np.maximum(glacier,polar).astype(np.float64)
    output=output*(1-ice[...,None])+np.asarray(ICE_COLOR)*ice[...,None]
    output[(classes==80)&(ice==0)]=0
    rgba=np.empty((*classes.shape,4),dtype=np.uint8)
    rgba[...,:3]=np.clip(np.floor(output+0.5),0,255).astype(np.uint8)
    rgba[...,3]=255
    return rgba


def compose_file(base_path, masks_path, output_path, receipt_path):
    import io
    import numpy as np
    from PIL import Image
    paths=[Path(p).resolve() for p in (base_path,masks_path,output_path,receipt_path)]
    base_path,masks_path,output_path,receipt_path=paths
    if len(set(paths))!=4 or output_path.exists() or receipt_path.exists():
        raise ValueError('Never overwrite inputs or an existing immutable result')
    source=base_path.read_bytes();mask_bytes=masks_path.read_bytes()
    with Image.open(io.BytesIO(source)) as image:
        rgb=np.asarray(image.convert('RGB'))
    with np.load(io.BytesIO(mask_bytes),allow_pickle=False) as masks:
        if set(masks.files)!={'worldcover','glacier','polar'}:
            raise ValueError('Explicit WorldCover/glacier/polar arrays required')
        rgba=compose_arrays(rgb,masks['worldcover'],masks['glacier'],masks['polar'])
        counts={'worldcoverKnownPixels':int(np.count_nonzero(masks['worldcover'])),
            'worldcoverSnowIcePixels':int(np.count_nonzero(masks['worldcover']==70)),
            'worldcoverWaterPixels':int(np.count_nonzero(masks['worldcover']==80)),
            'glacierCoveredPixels':int(np.count_nonzero(masks['glacier'])),
            'polarCoveredPixels':int(np.count_nonzero(masks['polar']))}
    stream=io.BytesIO()
    Image.fromarray(rgba).save(stream,format='WEBP',lossless=True,quality=80,method=6,exact=True)
    result=stream.getvalue()
    with Image.open(io.BytesIO(result)) as restored:
        if restored.convert('RGBA').tobytes()!=rgba.tobytes():
            raise ValueError('WebP roundtrip differs from the composed surface')
    output_path.parent.mkdir(parents=True,exist_ok=True)
    receipt_path.parent.mkdir(parents=True,exist_ok=True)
    output_path.write_bytes(result)
    digest=lambda data:hashlib.sha256(data).hexdigest()
    receipt={'schema':'pando-natural-composition-v1','baseSha256':digest(source),'masksSha256':digest(mask_bytes),
        'outputSha256':digest(result),'decodedSha256':digest(rgba.tobytes()),'bytes':len(result),
        'pixelWidth':rgba.shape[1],'pixelHeight':rgba.shape[0],'alpha':255,'shadeIncluded':False,
        'geometryChanged':False,'snowInterpretation':'observed fixed-reference snow/ice, not reconstructed historical or permanent snow',
        **counts}
    receipt_path.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf8')
    return receipt


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--self-test',action='store_true')
    for name in ('base','masks','output','receipt'):parser.add_argument('--'+name)
    args=parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test()));return
    if not all((args.base,args.masks,args.output,args.receipt)):
        parser.error('--base --masks --output --receipt are required')
    print(json.dumps(compose_file(args.base,args.masks,args.output,args.receipt)))

if __name__=='__main__':main()
