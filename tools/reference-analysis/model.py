"""Local training architecture. No synthetic weights are accepted as a release."""
import torch
from torch import nn
from torch.nn import functional as F
from torchvision.models import mobilenet_v3_large, MobileNet_V3_Large_Weights


class Decode(nn.Module):
    def __init__(self, incoming, skip, outgoing):
        super().__init__()
        self.conv = nn.Sequential(nn.Conv2d(incoming + skip, outgoing, 3, padding=1, bias=False),
                                  nn.GroupNorm(8, outgoing), nn.ReLU(inplace=True),
                                  nn.Conv2d(outgoing, outgoing, 3, padding=1, bias=False),
                                  nn.GroupNorm(8, outgoing), nn.ReLU(inplace=True))

    def forward(self, value, skip):
        return self.conv(torch.cat([F.interpolate(value, size=skip.shape[-2:], mode="bilinear", align_corners=False), skip], dim=1))


class ReferenceBoundaryModel(nn.Module):
    def __init__(self, pretrained=False):
        super().__init__()
        weights = MobileNet_V3_Large_Weights.IMAGENET1K_V2 if pretrained else None
        self.encoder = mobilenet_v3_large(weights=weights).features
        self.overview = nn.Sequential(nn.Conv2d(3, 16, 5, stride=2, padding=2), nn.ReLU(),
                                      nn.Conv2d(16, 32, 3, stride=2, padding=1), nn.ReLU(),
                                      nn.AdaptiveAvgPool2d(1))
        self.context = nn.Sequential(nn.Conv2d(960 + 32 + 4, 256, 1), nn.ReLU())
        self.decode = nn.ModuleList([Decode(256, 112, 128), Decode(128, 40, 96), Decode(96, 24, 64), Decode(64, 16, 32)])
        self.head = nn.Conv2d(32, 7, 1)

    def forward(self, tile, overview, position):
        features = []
        value = tile
        for index, layer in enumerate(self.encoder):
            value = layer(value)
            if index in [1, 3, 6, 12]:
                features.append(value)
        context = self.overview(overview).expand(-1, -1, value.shape[2], value.shape[3])
        bounds = position[:, :, None, None].expand(-1, -1, value.shape[2], value.shape[3])
        value = self.context(torch.cat([value, context, bounds], dim=1))
        for decoder, skip in zip(self.decode, reversed(features)):
            value = decoder(value, skip)
        return F.interpolate(self.head(value), size=tile.shape[-2:], mode="bilinear", align_corners=False)


def skeleton(value, iterations=10):
    result = F.relu(value - F.max_pool2d(-F.max_pool2d(-value, 3, 1, 1), 3, 1, 1))
    for _ in range(iterations):
        value = torch.minimum(-F.max_pool2d(-value, (3, 1), 1, (1, 0)), -F.max_pool2d(-value, (1, 3), 1, (0, 1)))
        opened = F.max_pool2d(-F.max_pool2d(-value, 3, 1, 1), 3, 1, 1)
        update = F.relu(value - opened)
        result = result + F.relu(update - result * update)
    return result


def boundary_loss(logits, target, valid, positive_weight=None):
    valid = valid.expand_as(logits)
    probability = torch.sigmoid(logits) * valid
    truth = target * valid
    weight = None if positive_weight is None else torch.as_tensor(positive_weight, device=logits.device, dtype=logits.dtype).view(1, -1, 1, 1)
    bce = (F.binary_cross_entropy_with_logits(logits, target, reduction="none", pos_weight=weight) * valid).sum() / valid.sum().clamp_min(1)
    axes = (0, 2, 3)
    active = (valid.sum(axes) > 0).to(logits.dtype)
    dice = ((1 - (2 * (probability * truth).sum(axes) + 1) / (probability.sum(axes) + truth.sum(axes) + 1)) * active).sum() / active.sum().clamp_min(1)
    predicted_skeleton, true_skeleton = skeleton(probability[:, :3]), skeleton(truth[:, :3])
    precision = ((predicted_skeleton * truth[:, :3]).sum() + 1) / (predicted_skeleton.sum() + 1)
    recall = ((true_skeleton * probability[:, :3]).sum() + 1) / (true_skeleton.sum() + 1)
    connectivity = 1 - 2 * precision * recall / (precision + recall).clamp_min(1e-6)
    return bce + dice + .1 * connectivity
