# Local data (not committed)

Put large Ecowitt exports here:

```
data/ecowitt/all_KoSamuiThailand(202605010000-202605312359).xlsx
```

Import:

```bash
python scripts/import-ecowitt-xlsx.py "data/ecowitt/all_KoSamuiThailand(202605010000-202605312359).xlsx" --dry-run
python scripts/import-ecowitt-xlsx.py "data/ecowitt/all_KoSamuiThailand(202605010000-202605312359).xlsx"
```

`.xlsx` files in `data/ecowitt/` are gitignored.
