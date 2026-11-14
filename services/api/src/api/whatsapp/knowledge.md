# Field Signal: what the assistant may say

Everything the chat assistant is allowed to explain. If it is not here or in the
field results, the assistant says it does not know.
REVIEW BEFORE THE PITCH: Răzvan (method), Bogdan (data), mentor (agronomy lines marked [agro]).

## What Field Signal is
- A free decision-support tool built by team Farm Titans at the NASA Space Apps Challenge 2026 in Alba Iulia. It uses open NASA data. It is not made or endorsed by NASA, and not by Transavia.
- The farmer sends the location of a field. Field Signal looks at about 25 years of satellite and weather data for that place and compares 3 crop rotations for the next 3 years: the farmer's current one and two alternatives (at least one with peas).
- For each rotation it shows a score from 0 to 100, a range (how uncertain the score is), why it was suggested, the evidence, the benefits, the risks and what we do not know.
- It supports the farmer's judgment. It does not replace the farmer, an agronomist or the local agricultural office.
- There is also a web app with maps and charts, and a view for feed buyers that adds up results across communes around the feed mill (where maize is at risk, where quality is threatened, which lots to test).

## How to use the WhatsApp bot
- Send the field location: 📎 → Locație/Location → send.
- Write "de ce 1", "de ce 2" or "de ce 3" (or "why 2") for details on one rotation.
- Ask anything about the results or how the tool works. Write "en" for English, "ro" for Romanian.

## Data we use (plain words)
- NASA POWER: daily weather since 1981 (temperature, rain, sun, humidity). One value covers a cell of roughly 50 km, so it describes the area, not one parcel.
- SMAP (NASA satellite): how wet the soil is, near the surface and in the root zone, since 2015. Cells of about 9 km.
- MODIS (NASA satellite): how green and active the vegetation is (NDVI), every 16 days since 2000, at 250 m.
- SoilGrids (ISRIC): soil texture, pH and organic carbon, estimated by a model at 250 m. Estimates, not a soil test.
- EUCROPMAP (EU JRC) and INS (Romanian statistics institute): which crops grow where, and official county yields we use to check if the method would have been right in past years, misses included.

## How scores work
- The farmer can say what matters most: yield, water, soil health or risk. The score mixes indicators for those priorities with fixed rules about each crop.
- The range next to a score shows uncertainty: a wide range means we are less sure.
- Confidence is "low", "medium" or "high" for each rotation.
- The exact weights are shown in the web app. The bot must not make up formulas.

## Words explained
- NDVI: a number from satellite images that shows how green and healthy plants are. Higher means more green leaves.
- Soil moisture anomaly: how much wetter or drier the soil is than usual for that time of year at that place.
- Evapotranspiration (ET): water leaving the field into the air, from the soil and through the plants. High ET with little rain means the soil dries out.
- Water balance: rain minus the water the field loses. Negative means a deficit.
- Heat-stress days: days hotter than a threshold during a sensitive crop stage, such as maize flowering.
- Frost risk: how often frost happened after sowing or before harvest in past years.
- Crop rotation: changing which crop grows on a field from year to year.
- Cover crop: a crop sown between main crops to keep the soil covered (for example mustard or phacelia).

## General agronomy (general knowledge; local details need an agronomist) [agro]
- Legumes such as soybean and peas take nitrogen from the air with bacteria on their roots, so the next crop usually needs less nitrogen fertiliser. [high confidence in general; how much depends on the field]
- Growing the same crop often on one field can build up pests and diseases; rotation breaks those cycles. [high]
- Cover crops reduce bare soil, erosion and nutrient loss over winter. [high]
- Heat and drought at maize flowering lower yield and raise the risk of aflatoxins (a mould toxin). [high in general; the exact thresholds we use need review]
- Wet, humid weather when wheat flowers raises the risk of fusarium and mycotoxins. [high in general]
- Rain at harvest can lower grain quality. [high]

## Limits (always be honest about these)
- Satellite and weather cells are larger than a parcel; results describe the area around the field.
- Past years do not guarantee the next ones.
- The tool does not know the farmer's irrigation, hybrid or variety, machinery, prices or contracts unless told.
- It does not give fertiliser or pesticide doses, prices, or legal or subsidy advice.

## Privacy
- The bot does not save the phone number or location after the conversation. Conversations are forgotten after about 2 hours.
