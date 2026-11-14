# Field Signal

Field Signal, by team Farm Titans, is crop-rotation decision support for Romanian farmers, built on NASA Earth observation data. It combines climate, soil-moisture and vegetation signals with soil and crop maps to show which rotation choices fit a field's changing conditions, plus a feed-buyer sourcing view that helps livestock operations find where forage and feed crops are likely to be available (SPACE2FEED, Direction A).

Created at the **NASA Space Apps Challenge 2026** (14–15 Nov 2026) for the challenge *Field Shift: Adapting Farms with NASA Data*. This is an independent hackathon project; it is not endorsed by or affiliated with NASA.

**Live demo:** https://fieldsignal.land (API: https://api.fieldsignal.land/docs). Both scale to zero, so the first visit after a quiet spell takes a few seconds.

## Team

| Who | Role | Owns |
|---|---|---|
| Vlad | Web + API | `apps/web`, `services/api` |
| Bogdan | Data pipelines | `data/` |
| Răzvan | Modelling | `ml/` |

## Repo map

```
apps/web/        Next.js (App Router, TS, Tailwind, next-intl ro/en, MapLibre GL)
services/api/    FastAPI (Python 3.12, pydantic v2)
data/            datasets and pipelines (scripts/; raw/ and cache/ are gitignored)
ml/              risk / yield-anomaly model + notebooks
contracts/       shared JSON Schemas for team handoffs
docs/            brief, decisions, submission notes
```

## Quickstart

Requirements: Node 22+, pnpm 10, [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for you).

```bash
cp .env.example .env          # fill in Earthdata credentials
pnpm install
uv sync --all-packages
```

**Web** — http://localhost:3000 (redirects to `/ro`; `/en` for English)

```bash
pnpm dev:web
```

**API** — http://localhost:8000/health, docs at `/docs`

```bash
pnpm dev:api
```

**Data**

```bash
uv run --package farm-data python data/scripts/<script>.py
```

Lint / format everything: `pnpm lint`, `pnpm format` (or `make lint`, `make format`).

## Deploy

Both apps run on Azure Container Apps (consumption plan, scale to zero) in resource group `rg-field-signal`. Every push to `main` that passes CI deploys automatically (`.github/workflows/deploy.yml`); day-to-day work goes to `dev` and reaches `main` through a PR. To deploy by hand, after `az login`, `scripts/deploy-azure.sh` builds the images, pushes them to the registry and rolls out both apps; pass `api` or `web` to deploy only one. DNS for fieldsignal.land is on Cloudflare (DNS only); both domains are custom domains on the Container Apps with Azure-managed certificates. The web image bakes in the API URL (`https://api.fieldsignal.land`) at build time.

## Data sources

Every input is public. Licence and attribution text is quoted from each provider's own page; where a term could not be confirmed, the row says so.

| Dataset | Provider | Resolution | Years | Licence / terms | Link | Used in |
|---|---|---|---|---|---|---|
| NASA POWER Daily API, AG community: `T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `ALLSKY_SFC_SW_DWN`, `WS2M`, `GWETROOT`, `GWETTOP`; FAO-56 ET₀ computed from them | NASA Langley Research Center, POWER Project | Meteorology from MERRA-2, 0.5° × 0.625°; solar from CERES/GEWEX, 1° | 1981–2025; `ALLSKY_SFC_SW_DWN`, and so ET₀, from 1984-01-01 | POWER asks for the acknowledgement quoted below | [power.larc.nasa.gov](https://power.larc.nasa.gov/) | `farm_data.power`, `data/scripts/fetch_point.py` |
| NASA SMAP L4 Global 3-hourly 9 km Surface and Root Zone Soil Moisture, `SPL4SMGP`. `farm_data.appeears`: `SPL4SMGP.008`, root-zone layer `Geophysical_Data_sm_rootzone` (daily mean of the 3-hourly values). `fetch_point.py`: the newest `SPL4SMGP` version AppEEARS lists, root-zone `sm_rootzone` and surface `sm_surface` layers | NASA NSIDC DAAC, sampled through AppEEARS (LP DAAC) | 9 km EASE-Grid; model-assimilated (Level 4), so one value covers many fields | 2015-03-31 to 2025 | NASA EOSDIS data, no use restriction; NSIDC requires the citation below | [doi:10.5067/T5RUATAQREF8](https://doi.org/10.5067/T5RUATAQREF8) | `farm_data.appeears`, `fetch_point.py`. Null in the feature table until the AppEEARS task lands; the fallback is POWER `GWETROOT` |
| NASA MODIS Vegetation Indices 16-day 250 m, Terra `MOD13Q1.061` and Aqua `MYD13Q1.061`: NDVI, EVI, pixel reliability. **Route 1: AppEEARS point samples** | NASA LP DAAC, through AppEEARS | 250 m: the pixel under each sample point, with its pixel-reliability value; 16-day composites, Terra and Aqua 8 days apart | Terra 2000–2025; Aqua 2002-07-04 to 2025 | NASA EOSDIS data, no use restriction; citation below | [doi:10.5067/MODIS/MOD13Q1.061](https://doi.org/10.5067/MODIS/MOD13Q1.061), [doi:10.5067/MODIS/MYD13Q1.061](https://doi.org/10.5067/MODIS/MYD13Q1.061) | `farm_data.appeears` → `ndvi_peak`, `ndvi_usable_share` |
| The same MODIS products. **Route 2: local cube** | Microsoft Planetary Computer copy (collection `modis-13Q1-061`) of the LP DAAC products | 2× overview of MOD13Q1/MYD13Q1: the ~463 m overview pixel nearest the centre of the 0.01° cell holding the point (up to ~0.005°, a few hundred metres, from it); no QA layer, so cloudy or snowy composites are not screened out and `ndvi_usable_share` is null; Terra and Aqua mixed | 2001–2026 (Aqua from 2002-07-04); no composites from 2025-06-26 to 2025-11-17, so 2025 summer peaks are null | LP DAAC terms as above (the Planetary Computer catalogue lists the collection's licence as "Proprietary") | [planetarycomputer.microsoft.com/dataset/modis-13Q1-061](https://planetarycomputer.microsoft.com/dataset/modis-13Q1-061) | `farm_data.modis_cube`, only for points AppEEARS has not returned |
| The same `MOD13Q1.061`, one-point access check | ORNL DAAC MODIS/VIIRS subsets web service (TESViS) | The 250 m pixel at one point | 2001–2025 (script default); no output from this route ships yet | NASA EOSDIS data, no use restriction; ORNL DAAC citation below | [modis.ornl.gov](https://modis.ornl.gov/) | `data/scripts/fetch_point.py` |
| ISRIC SoilGrids 2.0: SOC, pH(H₂O), clay, sand; 0–5, 5–15 and 15–30 cm, depth-weighted to 0–30 cm | ISRIC – World Soil Information | 250 m | One release (Poggio et al. 2021) | CC BY 4.0 | [soilgrids.org](https://soilgrids.org/), [doi:10.5194/soil-7-217-2021](https://doi.org/10.5194/soil-7-217-2021) | `farm_data.soil` (WCS), `fetch_point.py` |
| JRC EUCROPMAP 2018 and 2022 (crop-type maps) | European Commission, Joint Research Centre | 10 m. 2018: Sentinel-1 only. 2022: Sentinel-1 and Sentinel-2 with LUCAS 2022; overall accuracy 79.3 % (7 classes), 70.6 % (19 crops) | 2018, 2022 | European Commission reuse notice: reuse is authorised provided the source is acknowledged (Commission Decision of 12 December 2011). Contains modified Copernicus Sentinel data | [doi:10.2905/JRC.6ZVVSM8](https://doi.org/10.2905/JRC.6ZVVSM8) (2018), [doi:10.2905/JRC.7E1YJC8](https://doi.org/10.2905/JRC.7E1YJC8) (2022) | `farm_data.cropmap` (sample points, commune crop areas), `farm_data.zones` (communes with arable pixels), `farm_data.landmask`, `farm_data.firms` (cropland filter) |
| Arable mask: APIA declared farm parcels (LPIS), AGI ONLINE single applications, campaign 2025, `cat_use = 'TA'` (arable), combined with the EUCROPMAP 2022 arable classes | Agenția de Plăți și Intervenție pentru Agricultură (APIA), published on data.gov.ro; JRC for EUCROPMAP | Parcel polygons rasterized to 10 m (EPSG:3844) over Alba; a pixel is arable if APIA 2025 `TA` or EUCROPMAP 2022 marks it | 2025 (APIA holds only parcels declared that year); 2022 (EUCROPMAP) | APIA parcels: CC BY 4.0, modified (filtered to `TA`, rasterized, combined with EUCROPMAP). EUCROPMAP: as above | [data.gov.ro/dataset/parcele_agricole_agionline_apia](https://data.gov.ro/dataset/parcele_agricole_agionline_apia) | `farm_data.landmask` |
| INS TEMPO-Online `AGR108A` (area), `AGR109A` (production), `AGR110A` (yield) for 6 feed crops | Institutul Național de Statistică (INS) | County, yearly | 1990–2025 | Reuse terms not verified; credited here as INS, TEMPO-Online | [statistici.insse.ro:8077/tempo-online](http://statistici.insse.ro:8077/tempo-online/) | `farm_data.ins` |
| Eurostat GISCO NUTS 2024 (counties) and LAU 2024 (communes) | European Commission, Eurostat (GISCO) | NUTS 1:1 000 000; LAU 2024 polygons | 2024 | GISCO download terms: "the data will not be used for commercial purposes; the source will be acknowledged"; "© EuroGeographics for the administrative boundaries" | [GISCO administrative units](https://ec.europa.eu/eurostat/web/gisco/geodata/administrative-units) | `farm_data.zones` (`zone_id` is the LAU `GISCO_ID` without `RO_`; see note ¹), `farm_data.landmask` (Alba bounding box), `farm_data.firms` |
| NASA FIRMS active-fire detections, yearly country archives for Romania: MODIS Collection 6.1 standard `MCD14ML` (Terra and Aqua) and VIIRS S-NPP 375 m standard `VNP14IMGTML` | NASA FIRMS (LANCE, ESDIS) | Point detections: MODIS ~1 km pixel at nadir, VIIRS 375 m | MODIS 2001–2025, VIIRS 2012–2025 | NASA EOSDIS data, no use restriction; FIRMS acknowledgement below | [firms.modaps.eosdis.nasa.gov/country](https://firms.modaps.eosdis.nasa.gov/country/); MODIS: [doi:10.5067/FIRMS/MODIS/MCD14ML](https://doi.org/10.5067/FIRMS/MODIS/MCD14ML) | `farm_data.firms` (detections on cropland per commune and season) |
| Crop traits: values cited from FAO ECOCROP, FAO-56, FAO-66, the GGCMI Phase 3 crop calendar, GRDC GrowNotes Sunflower North §14, Legume Futures Report 1.6 and 13 papers (listed below) | FAO; GGCMI; GRDC; Legume Futures; journal authors | Per crop | — | Single values, each with its source on its row (terms: FAO-56 © FAO 1998, all rights reserved; FAO-66 © FAO 2012, non-commercial use authorised on request; ECOCROP terms not verified; GGCMI calendar CC BY 4.0; GRDC terms not verified; Legume Futures © The Authors 2014, non-commercial reproduction with the source acknowledged; papers as listed below) | Per row, in the CSV | `data/reference/crop_traits_A.csv` |
| Soil and N₂O emission factors: values cited from the 2019 Refinement to the 2006 IPCC Guidelines, Vol. 4 Ch. 11 (58 rows), the 2006 IPCC Guidelines, Vol. 4 Ch. 11 (4 rows), and IPCC AR6 WGI Ch. 7 (N₂O GWP-100) | IPCC | Default factors | 2006, 2019, 2021 | © IPCC. Personal, non-commercial use only, with no right "to compile or create derivative works"; "For any other use, permission is required" (full terms quoted below). Each CSV row gives its page or table, as IPCC asks. Whether this compilation may sit in a public repo is an open team decision (below) | [2019 Refinement Vol. 4 Ch. 11](https://www.ipcc-nggip.iges.or.jp/public/2019rf/pdf/4_Volume4/19R_V4_Ch11_Soils_N2O_CO2.pdf) | `data/reference/ipcc_soil_ef.csv` |
| Basemap: OpenFreeMap vector tiles, styles `liberty` and `dark` (OpenMapTiles schema, OpenStreetMap data); the `liberty` style also draws Natural Earth shaded relief (`ne2_shaded`, zooms 0–7) | OpenFreeMap; OpenMapTiles; OpenStreetMap contributors; Natural Earth | Vector tiles; raster relief tiles | Live | OpenStreetMap data is under the Open Database License (ODbL); OpenFreeMap requires attribution, which MapLibre shows on the map: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap". Natural Earth (public domain) | [openfreemap.org](https://openfreemap.org/), [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright), [naturalearthdata.com/about/terms-of-use](https://www.naturalearthdata.com/about/terms-of-use/) | `apps/web/src/components/map/use-map.ts`, `apps/web/src/lib/land-cover.ts` (roads, buildings, water, woods) |
| Elevation: Terrain Tiles, Terrarium encoding (3D terrain and hillshade) | Mapzen / Tilezen, hosted on the AWS Open Data registry; built from EU-DEM (Copernicus), SRTM, GMTED2010, ETOPO1 and other sources | Raster DEM tiles up to zoom 14 | Live | Attribution required (list quoted below) | [registry.opendata.aws/terrain-tiles](https://registry.opendata.aws/terrain-tiles/) | `apps/web/src/components/map/use-map.ts` |

¹ For Romania, every LAU 2024 `GISCO_ID` is `RO_` plus the commune's SIRUTA code (all 3,181 checked against SIRUTA_s1 2026, Institutul Național de Statistică, https://data.gov.ro/dataset/siruta_s1-2026, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). So a commune's `zone_id` is its SIRUTA code. The pipeline does not read the SIRUTA file.

**Scale.** NDVI from either MODIS route describes the area around a zone's sample points, not a farmer's field: an AppEEARS value is one 250 m pixel (about 6 ha), and a cube value is the ~463 m overview pixel (about 21 ha, from the MODIS file's 2× overview) nearest the centre of the 0.01° cell holding the point (up to ~0.005°, a few hundred metres, from it). A SMAP value is a 9 km model pixel. Its fallback, POWER `GWETROOT` (feature `gwetroot_critical`), is one 0.5° × 0.625° MERRA-2 cell, about 50 km across.

### Acknowledgements and citations

- **NASA POWER:** "The data was obtained from National Aeronautics and Space Administration (NASA) Langley Research Center's Prediction Of Worldwide Energy Resources (POWER) project funded through the NASA Earth Science Division." The data was obtained from the POWER Project's Daily 2.10.3 version on 2026/11/13.
- **NASA EOSDIS data (SMAP, MODIS, FIRMS):** "While there are no restrictions on the use of these data, data users are very strongly urged to cite the data used in their work products." ([EOSDIS data use guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance))
- **SMAP (NSIDC):** "As a condition of using these data, you must cite the use of this data set." Reichle, R., De Lannoy, G., Koster, R. D., Crow, W. T., Kimball, J. S., Liu, Q. & Bechtold, M. (2025). SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture Geophysical Data. (SPL4SMGP, Version 8). [Data Set]. Boulder, Colorado USA. NASA National Snow and Ice Data Center Distributed Active Archive Center. https://doi.org/10.5067/T5RUATAQREF8.
- **MODIS (LP DAAC):** K. Didan. 2021. MOD13Q1 MODIS/Terra Vegetation Indices 16-Day L3 Global 250m SIN Grid V061. NASA EOSDIS Land Processes DAAC. https://doi.org/10.5067/MODIS/MOD13Q1.061. K. Didan. 2021. MYD13Q1 MODIS/Aqua Vegetation Indices 16-Day L3 Global 250m SIN Grid V061. NASA EOSDIS Land Processes DAAC. https://doi.org/10.5067/MODIS/MYD13Q1.061.
- **AppEEARS:** AppEEARS Team, 2026, Application for Extracting and Exploring Analysis Ready Samples (AppEEARS), Ver. 3.137: NASA EOSDIS Land Processes Distributed Active Archive Center (LP DAAC), USGS/Earth Resources Observation and Science (EROS) Center, Sioux Falls, South Dakota, USA, accessed November 14, 2026. Subsets: point samples at the zone sample points; `MOD13Q1.061` and `MYD13Q1.061` layers `_250m_16_days_NDVI`, `_250m_16_days_EVI` and `_250m_16_days_pixel_reliability`, 2000-01-01 to 2025-12-31; `SPL4SMGP.008` layer `Geophysical_Data_sm_rootzone`, 2015-03-31 to 2025-12-31.
- **ORNL DAAC:** ORNL DAAC 2018. TESViS Global Subsets Tool. ORNL DAAC, Oak Ridge, Tennessee, USA. https://doi.org/10.3334/ORNLDAAC/1379. A `fetch_point.py` run cites its own access date, point and period (template: modis.ornl.gov/citation.html).
- **FIRMS:** "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS)."
- **SoilGrids:** "The SoilGrids maps are publicly available on the SoilGrids website under the CC-BY 4.0 License." Poggio, L., de Sousa, L., Batjes, N., Heuvelink, G., Kempen, B., Ribeiro, E., Rossiter, D. (2021). SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty. SOIL 7, 217–240. https://doi.org/10.5194/soil-7-217-2021.
- **EUCROPMAP:** "European Commission, Joint Research Centre (2026): EUCROPMAP 2022. [Dataset] doi: 10.2905/JRC.7E1YJC8". d'Andrimont, R., Verhegghen, A., Lemoine, G., Kempeneers, P., Meroni, M., van der Velde, M. (2026): EUCROPMAP 2018. European Commission, Joint Research Centre. https://doi.org/10.2905/JRC.6ZVVSM8. Papers: d'Andrimont et al. (2021), Remote Sensing of Environment 266, 112708, https://doi.org/10.1016/j.rse.2021.112708; Ghassemi et al. (2024), Scientific Data 11, 1048, https://doi.org/10.1038/s41597-024-03884-y.
- **Copernicus:** Contains modified Copernicus Sentinel data [2018, 2022] (through EUCROPMAP).
- **APIA:** Parcele agricole declarate de fermieri în cadrul cererilor unice de plată în aplicația AGI ONLINE – Campania 2025, © Agenția de Plăți și Intervenție pentru Agricultură, https://data.gov.ro/dataset/parcele_agricole_agionline_apia, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Modified: filtered to `cat_use = 'TA'` and rasterized to a 10 m arable mask.
- **GISCO:** © EuroGeographics for the administrative boundaries.
- **INS:** Institutul Național de Statistică, TEMPO-Online, tables AGR108A, AGR109A, AGR110A. Reuse terms not verified: insse.ro shows an "OGL" badge in its page header, linking to the Open Government Licence Romania 1.0 (http://data.gov.ro/base/images/logoinst/OGL-ROU-1.0.pdf), but no INS page we found says which licence covers TEMPO-Online data. This README is the one place that states INS terms.
- **OpenStreetMap / OpenFreeMap:** OpenFreeMap © OpenMapTiles Data from OpenStreetMap. OpenStreetMap data is available under the [Open Database License](https://opendatacommons.org/licenses/odbl/); credit: OpenStreetMap and its contributors.
- **Natural Earth:** Made with Natural Earth. "All versions of Natural Earth raster + vector map data found on this website are in the public domain." ([terms of use](https://www.naturalearthdata.com/about/terms-of-use/))
- **IPCC** ([ipcc.ch/copyright](https://www.ipcc.ch/copyright/)): "You may freely download and copy the material contained on this website for your personal, non-commercial use, without any right to resell or redistribute it or to compile or create derivative works there from, subject to more specific restrictions that may apply to specific materials." "For such personal, non-commercial usages, reproduction of limited number of figures or short excerpts of IPCC material is authorized free of charge and without formal written permission provided that the original source is properly acknowledged, with mention of the complete name of the report, the publisher and the numbering of the page(s) or the figure(s)." "For any other use, permission is required." Full citations are under Reference values.
- **Terrain Tiles** (required attribution, from [tilezen/joerd `docs/attribution.md`](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)):
  ```
  * ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and
    funded under National Science Foundation awards 1043681, 1559691, and 1542736;
  * Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;
  * Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM)
    Österreich;
  * Canada terrain data contains information licensed under the Open Government
    Licence – Canada;
  * Europe terrain data produced using Copernicus data and information funded by the
    European Union - EU-DEM layers;
  * Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration
  * Mexico terrain data source: INEGI, Continental relief, 2016;
  * New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New
    Zealand and the New Zealand Government (All rights reserved);
  * Norway terrain data © Kartverket;
  * United Kingdom terrain data © Environment Agency copyright and/or database right
    2015. All rights reserved;
  * United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data
    courtesy of the U.S. Geological Survey.
  ```

### Reference values (`data/reference/`)

Each CSV row carries its own source and page. The works behind them:

- FAO ECOCROP, https://gaez.fao.org/pages/ecocrop (terms not verified).
- FAO Irrigation and Drainage Paper 56, ch. 6 and 8, https://www.fao.org/4/x0490e/x0490e00.htm (© FAO 1998, all rights reserved).
- FAO Irrigation and Drainage Paper 66, Steduto et al. 2012, https://www.fao.org/4/i2800e/i2800e00.htm (© FAO 2012; "Non-commercial uses will be authorized free of charge, upon request").
- Jägermeyr, J., Müller, C., Minoli, S., Ray, D., Siebert, S. (2021). GGCMI Phase 3 crop calendar. Zenodo. https://doi.org/10.5281/zenodo.5062513 (CC BY 4.0).
- GRDC GrowNotes Sunflower, Northern region, section 14 Environment, https://grdc.com.au/__data/assets/pdf_file/0019/370621/GrowNote-Sunflower-North-14-Environment.pdf (terms not verified).
- Reckling, M., Preissel, S., Zander, P., Topp, K., Watson, C., Murphy-Bokern, D., Stoddard, F.L. (2014). Effects of legume cropping on farming and food systems. Legume Futures Report 1.6, https://www.legumehub.eu/wp-content/uploads/2021/06/Legume-Futures-Report-1.6.pdf (© The Authors 2014; non-commercial reproduction authorised with the source acknowledged).
- IPCC 2019, 2019 Refinement to the 2006 IPCC Guidelines for National Greenhouse Gas Inventories, Calvo Buendia, E., Tanabe, K., Kranjc, A., Baasansuren, J., Fukuda, M., Ngarize, S., Osako, A., Pyrozhenko, Y., Shermanau, P. and Federici, S. (eds). Published: IPCC, Switzerland. Vol. 4 Ch. 11, https://www.ipcc-nggip.iges.or.jp/public/2019rf/pdf/4_Volume4/19R_V4_Ch11_Soils_N2O_CO2.pdf (58 rows).
- IPCC 2006, 2006 IPCC Guidelines for National Greenhouse Gas Inventories, Prepared by the National Greenhouse Gas Inventories Programme, Eggleston H.S., Buendia L., Miwa K., Ngara T. and Tanabe K. (eds). Published: IGES, Japan. Vol. 4 Ch. 11, https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/4_Volume4/V4_11_Ch11_N2O%26CO2.pdf (4 rows).
- Forster, P., T. Storelvmo, K. Armour, W. Collins, J.-L. Dufresne, D. Frame, D.J. Lunt, T. Mauritsen, M.D. Palmer, M. Watanabe, M. Wild, and H. Zhang, 2021: The Earth's Energy Budget, Climate Feedbacks, and Climate Sensitivity. In Climate Change 2021: The Physical Science Basis. Contribution of Working Group I to the Sixth Assessment Report of the Intergovernmental Panel on Climate Change [Masson-Delmotte, V., P. Zhai, A. Pirani, et al. (eds.)]. Cambridge University Press, Cambridge, United Kingdom and New York, NY, USA, pp. 923–1054, https://doi.org/10.1017/9781009157896.009 (1 row, N₂O GWP-100).
- IPCC terms are quoted under Acknowledgements; the `locator` column of each CSV row gives the page or table. **Open team decision:** `data/reference/ipcc_soil_ef.csv` is a compilation of 63 IPCC factors (58 + 4 + 1 rows above). Whether it may sit in a public repo under those terms is not decided here.
- Papers, open access CC BY: Liu et al. 2023, Plant Communications, https://doi.org/10.1016/j.xplc.2023.100629; Pleadin et al. 2023, Foods, https://doi.org/10.3390/foods12030548; Zhao et al. 2022, Nature Communications, https://doi.org/10.1038/s41467-022-32464-0; Devi et al. 2023, Frontiers in Plant Science, https://doi.org/10.3389/fpls.2022.1108276; Battilani et al. 2016, Scientific Reports, https://doi.org/10.1038/srep24328.
- Papers, CC BY 3.0: Anglade et al. 2015, Ecosphere, https://doi.org/10.1890/ES14-00353.1.
- Papers, CC BY-NC-ND: Hatfield & Prueger 2015, Weather and Climate Extremes, https://doi.org/10.1016/j.wace.2015.08.001; Preissel et al. 2015, Field Crops Research, https://doi.org/10.1016/j.fcr.2015.01.012.
- Papers, licence not stated in Crossref: Medina et al. 2014, Frontiers in Microbiology, https://doi.org/10.3389/fmicb.2014.00348.
- Papers, subscription: Hooker et al. 2002, Plant Disease, https://doi.org/10.1094/PDIS.2002.86.6.611; Porter & Gawith 1999, European Journal of Agronomy, https://doi.org/10.1016/S1161-0301(98)00047-1; De Wolf et al. 2003, Phytopathology, https://doi.org/10.1094/PHYTO.2003.93.4.428; Herridge et al. 2008, Plant and Soil, https://doi.org/10.1007/s11104-008-9668-3.

How to rebuild everything: [`data/README.md`](data/README.md).

## License

[MIT](LICENSE)
