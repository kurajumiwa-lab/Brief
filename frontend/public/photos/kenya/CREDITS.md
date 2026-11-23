# Photographs used in Brief

All photographs in `public/photos/kenya/` come from **Pexels** and are used under
the [Pexels licence](https://www.pexels.com/license/), which permits free
commercial use without attribution. Attribution is recorded here anyway, because
"we don't legally have to" is a poor reason to lose track of where a picture came
from — and because the next person needs to know which file is which.

Every image below was **opened and looked at** before it was added. Captions on
stock sites are unreliable: searches for "Kenya market" returned South African,
Nigerian, Indian and Vietnamese markets, and one hardware shop with Turkish
signage. Those were rejected. A mislabelled photograph is worse than no
photograph, because it tells a lie about who this product is for.

## Files

| File | Subject | Source (Pexels photo id) |
|---|---|---|
| `goods-bananas.jpg` | Roadside kiosk, bananas and produce | [33730406](https://www.pexels.com/photo/33730406/) |
| `goods-kiosk.jpg` | Two timber kiosks on a Nairobi street | [33730494](https://www.pexels.com/photo/33730494/) |
| `goods-produce.jpg` | Stall stacked with bananas, tomatoes, mangoes | [9956723](https://www.pexels.com/photo/9956723/) |
| `goods-fruit-stall.jpg` | Fruit market under canvas | [9844130](https://www.pexels.com/photo/9844130/) |
| `goods-tomatoes.jpg` | Woman selling tomatoes from a basin | [3213283](https://www.pexels.com/photo/3213283/) |
| `services-tailor.jpg` | Tailor at his machine with fabric | [11645428](https://www.pexels.com/photo/11645428/) |
| `services-boda.jpg` | Boda boda rider, Nairobi street | [33757408](https://www.pexels.com/photo/33757408/) |
| `services-artisan.jpg` | Metalworker at his bench | [3760958](https://www.pexels.com/photo/3760958/) |
| `events-dance.jpg` | Celebration in traditional dress | [37118610](https://www.pexels.com/photo/37118610/) |
| `events-gathering.jpg` | Community gathering, outdoor performance | [3764310](https://www.pexels.com/photo/3764310/) |
| `banner-street.jpg` | Kiosks, wide crop of `goods-kiosk` | [33730494](https://www.pexels.com/photo/33730494/) |
| `banner-produce.jpg` | Tomato stall, wide crop | [3213283](https://www.pexels.com/photo/3213283/) |
| `banner-community.jpg` | Gathering, wide crop | [3764310](https://www.pexels.com/photo/3764310/) |
| `hero-market.jpg` | Kiosks, 16:9 hero crop | [33730494](https://www.pexels.com/photo/33730494/) |

## Resolution, honestly

The sandbox this was assembled in could reach Pexels' **search results** but not
`images.pexels.com`, so these are derived from the ~500–1100px previews the
search index serves, not the full-size originals. Crops:

- cards `640×480` (4:3) — right for a two-column mobile grid at 2× DPR
- banners `960×411` (21:9)
- hero `1100×619` (16:9)

That is acceptable for cards and banners. **It is not enough for a full-bleed
retina hero**, so `hero-market.jpg` is used at constrained widths and is not
smeared across a wide desktop. If better originals are wanted, replace these
files in place at the same paths, aspect ratios and names — no code changes are
needed.

## Colour grading

Nothing is tinted, filtered or cropped to hide its origin. The photographs are
resized, cropped to the aspect ratios above, stripped of metadata and re-encoded
at quality 80–82. The teal/coral palette lives in the UI around them, not over
them: the brief asks for authentic photography, and a colour overlay would defeat
the point.
