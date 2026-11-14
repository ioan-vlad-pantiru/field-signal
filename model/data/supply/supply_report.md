# Supply table per NUTS3 zone and crop

- rows: 952
- zones: 136
- crops: 7
- rows with no area: 62
- rows with low support (n_points < 30): 29

## 10 largest zones by maize production_p50

| nuts3 | area_ha | production_p50 (t) | n_points |
|---|---|---|---|
| RS127 | 330636 | 1961308 | 300 |
| HU232 | 126748 | 967962 | 300 |
| RO315 | 155378 | 791994 | 300 |
| RO221 | 105267 | 591350 | 300 |
| RO424 | 139059 | 585805 | 300 |
| SK021 | 101918 | 575618 | 300 |
| RS122 | 81205 | 552118 | 300 |
| HU323 | 90080 | 520654 | 300 |
| RO411 | 130047 | 487460 | 300 |
| RO312 | 115842 | 476825 | 300 |

## Zones and crops with no area

- BG424 barley (n_points 9)
- HR031 barley (n_points 4)
- HR037 barley (n_points 34)
- HR064 dry_pulses (n_points 174)
- HU110 dry_pulses (n_points 31)
- AT130 maize (n_points 11)
- BG424 maize (n_points 9)
- HR037 maize (n_points 34)
- BG424 rapeseed (n_points 9)
- HR031 rapeseed (n_points 4)
- HR032 rapeseed (n_points 300)
- HR034 rapeseed (n_points 31)
- HR035 rapeseed (n_points 35)
- HR064 rapeseed (n_points 174)
- HU110 rapeseed (n_points 31)
- RO124 rapeseed (n_points 121)
- AT130 soybeans (n_points 11)
- BG311 soybeans (n_points 300)
- BG312 soybeans (n_points 300)
- BG313 soybeans (n_points 300)
- BG314 soybeans (n_points 300)
- BG315 soybeans (n_points 300)
- BG321 soybeans (n_points 300)
- BG322 soybeans (n_points 198)
- BG323 soybeans (n_points 300)
- BG324 soybeans (n_points 300)
- BG325 soybeans (n_points 300)
- BG331 soybeans (n_points 300)
- BG332 soybeans (n_points 300)
- BG333 soybeans (n_points 300)
- BG334 soybeans (n_points 300)
- BG341 soybeans (n_points 300)
- BG342 soybeans (n_points 300)
- BG343 soybeans (n_points 300)
- BG344 soybeans (n_points 300)
- BG411 soybeans (n_points 300)
- BG412 soybeans (n_points 300)
- BG413 soybeans (n_points 300)
- BG414 soybeans (n_points 300)
- BG415 soybeans (n_points 300)
- BG421 soybeans (n_points 300)
- BG422 soybeans (n_points 300)
- BG423 soybeans (n_points 300)
- BG424 soybeans (n_points 9)
- HR031 soybeans (n_points 4)
- HR033 soybeans (n_points 234)
- HR034 soybeans (n_points 31)
- HR037 soybeans (n_points 34)
- HU110 soybeans (n_points 31)
- RO124 soybeans (n_points 121)
- RO311 soybeans (n_points 300)
- RO321 soybeans (n_points 84)
- RO412 soybeans (n_points 300)
- RO415 soybeans (n_points 300)
- BG424 sunflower (n_points 9)
- HR031 sunflower (n_points 4)
- HR034 sunflower (n_points 31)
- RO124 sunflower (n_points 121)
- SK031 sunflower (n_points 300)
- BG424 wheat (n_points 9)
- HR031 wheat (n_points 4)
- HR037 wheat (n_points 34)

Area is the 2022-2024 mean Eurostat `AR_THS_HA` for the NUTS2 region times the zone's share of the region's weighted points growing the crop in 2022-2024. Production is yield percentile x area; `regional_normal_flag` is true for wheat, barley, rapeseed and dry_pulses. Their `yield_p50` is the regional normal; `yield_p10`/`yield_p90` are the 10th/90th percentiles of the region's reported Eurostat yields over 2000-2024 and `worst_weather_year` is the year of its lowest reported yield. Maize, sunflower and soybeans keep the weather-driven model.
