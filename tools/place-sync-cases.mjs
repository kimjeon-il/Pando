/** Independently reviewed semantic fixtures; coordinates follow reports/places records. */
export const PLACE_SYNC_CASES = Object.freeze([
  {
    "id": "kyiv-date-precision",
    "record": {
      "source": "geonames",
      "sourceId": "703448",
      "name": "키이우",
      "nameEn": "Kyiv",
      "nameNative": "Київ",
      "kind": "capital",
      "coordinates": [
        30.5238,
        50.45466
      ],
      "countryCode": "UA",
      "featureCode": "PPLC",
      "nameTimeline": [
        {
          "fromYear": 1801,
          "ko": "키예프"
        },
        {
          "fromDate": "1991-08-24",
          "ko": "키이우"
        }
      ]
    },
    "scenarios": [
      {
        "date": null,
        "languages": {
          "ko": true,
          "en": false,
          "native": false
        },
        "rows": [
          [
            "ko",
            "키이우"
          ]
        ]
      },
      {
        "date": "1990-12-31",
        "languages": {
          "ko": true,
          "en": true,
          "native": true
        },
        "rows": [
          [
            "ko",
            "키예프"
          ],
          [
            "en",
            "Kyiv"
          ],
          [
            "native",
            "Київ"
          ]
        ]
      },
      {
        "date": "1991-08-23",
        "languages": {
          "ko": true,
          "en": true,
          "native": false
        },
        "rows": [
          [
            "ko",
            "키예프"
          ],
          [
            "en",
            "Kyiv"
          ]
        ]
      },
      {
        "date": "1991-08-24",
        "languages": {
          "ko": true,
          "en": true,
          "native": true
        },
        "rows": [
          [
            "ko",
            "키이우"
          ],
          [
            "en",
            "Kyiv"
          ],
          [
            "native",
            "Київ"
          ]
        ]
      },
      {
        "date": null,
        "languages": {
          "ko": false,
          "en": true,
          "native": true
        },
        "rows": [
          [
            "en",
            "Kyiv"
          ],
          [
            "native",
            "Київ"
          ]
        ]
      }
    ]
  },
  {
    "id": "mexico-city-native-short",
    "record": {
      "source": "geonames",
      "sourceId": "3530597",
      "name": "멕시코시티",
      "nameEn": "Mexico City",
      "nameNative": "México",
      "kind": "capital",
      "coordinates": [
        -99.12766,
        19.42847
      ],
      "countryCode": "MX",
      "featureCode": "PPLC"
    },
    "scenarios": [
      {
        "date": null,
        "languages": {
          "ko": true,
          "en": true,
          "native": true
        },
        "rows": [
          [
            "ko",
            "멕시코시티"
          ],
          [
            "en",
            "Mexico City"
          ],
          [
            "native",
            "México"
          ]
        ]
      },
      {
        "date": null,
        "languages": {
          "ko": false,
          "en": false,
          "native": true
        },
        "rows": [
          [
            "native",
            "México"
          ]
        ]
      }
    ]
  },
  {
    "id": "budapest-duplicate-en-native",
    "record": {
      "source": "geonames",
      "sourceId": "3054643",
      "name": "부다페스트",
      "nameEn": "Budapest",
      "nameNative": "Budapest",
      "kind": "capital",
      "coordinates": [
        19.04045,
        47.49835
      ],
      "countryCode": "HU",
      "featureCode": "PPLC"
    },
    "scenarios": [
      {
        "date": null,
        "languages": {
          "ko": true,
          "en": true,
          "native": true
        },
        "rows": [
          [
            "ko",
            "부다페스트"
          ],
          [
            "en",
            "Budapest"
          ]
        ]
      },
      {
        "date": null,
        "languages": {
          "ko": false,
          "en": true,
          "native": true
        },
        "rows": [
          [
            "en",
            "Budapest"
          ]
        ]
      },
      {
        "date": null,
        "languages": {
          "ko": false,
          "en": false,
          "native": true
        },
        "rows": [
          [
            "native",
            "Budapest"
          ]
        ]
      }
    ]
  },
  {
    "id": "brussels-primary-native",
    "record": {
      "source": "geonames",
      "sourceId": "2800866",
      "name": "브뤼셀",
      "nameEn": "Brussels",
      "nameNative": "Bruxelles",
      "kind": "capital",
      "coordinates": [
        4.34878,
        50.85045
      ],
      "countryCode": "BE",
      "featureCode": "PPLC"
    },
    "scenarios": [
      {
        "date": null,
        "languages": {
          "ko": true,
          "en": true,
          "native": true
        },
        "rows": [
          [
            "ko",
            "브뤼셀"
          ],
          [
            "en",
            "Brussels"
          ],
          [
            "native",
            "Bruxelles"
          ]
        ]
      }
    ]
  }
]);
