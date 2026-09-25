-- Every studio had gtm_country and gtm_city_state NULL, so the booking
-- funnel reported studioCity="" and studioCountry="United States" for all
-- 46 — including any studio outside the US. Ad platforms segment on those
-- two fields, so the campaign data was unusable per city.
--
-- Derived from the address we already hold. If the live Laravel database
-- has curated values, importing them overwrites these.
update locations
set gtm_city_state = coalesce(
      nullif(gtm_city_state, ''),
      case
        when coalesce(state, '') <> '' then city || ', ' || state
        else city
      end
    ),
    gtm_country = coalesce(
      nullif(gtm_country, ''),
      case country_code
        when 'US' then 'United States'
        when 'TR' then 'Türkiye'
        when 'DE' then 'Germany'
        when 'GB' then 'United Kingdom'
        when 'NL' then 'Netherlands'
        when 'ES' then 'Spain'
        when 'IT' then 'Italy'
        when 'FR' then 'France'
        when 'AT' then 'Austria'
        when 'CH' then 'Switzerland'
        when 'CA' then 'Canada'
        else country
      end
    )
where gtm_city_state is null or gtm_country is null
   or gtm_city_state = '' or gtm_country = '';
