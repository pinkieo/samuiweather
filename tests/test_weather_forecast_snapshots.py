import importlib.util
import os
import unittest


SPEC = importlib.util.spec_from_file_location(
    "weather_engine_hourly",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "weather_engine_hourly.py"),
)
assert SPEC and SPEC.loader
engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)


class ForecastSnapshotTests(unittest.TestCase):
    def test_lead_hours_uses_utc(self):
        self.assertEqual(
            engine.forecast_lead_hours(
                "2026-08-07T12:00:00Z",
                "2026-08-07T06:00:00+00:00",
            ),
            6.0,
        )

    def test_different_issuances_produce_distinct_hashes(self):
        base = {
            "valid_time": "2026-08-07T12:00:00Z",
            "issuance_time": "2026-08-07T06:00:00Z",
            "flat": {
                "valid_time_utc": "2026-08-07T12:00:00+00:00",
                "values_json": {"air_temperature": 300},
            },
        }
        later = {**base, "issuance_time": "2026-08-07T09:00:00Z"}
        first = engine.build_forecast_snapshot_row(
            "samui_opf_hybrid", 9.5127, 100.0137, base, "2026-08-07T06:01:00Z", False
        )
        second = engine.build_forecast_snapshot_row(
            "samui_opf_hybrid", 9.5127, 100.0137, later, "2026-08-07T09:01:00Z", True
        )
        self.assertNotEqual(first["snapshot_hash"], second["snapshot_hash"])
        self.assertEqual(first["forecast_lead_hours"], 6.0)
        self.assertEqual(second["forecast_lead_hours"], 3.0)

    def test_same_issuance_is_idempotent_and_labels_hybrid_source(self):
        source = {
            "valid_time": "2026-08-07T12:00:00Z",
            "issuance_time": "2026-08-07T06:00:00Z",
            "flat": {
                "valid_time_utc": "2026-08-07T12:00:00+00:00",
                "values_json": {"probability_of_thunderstorm": 0.2},
            },
        }
        first = engine.build_forecast_snapshot_row(
            "samui_opf_hybrid", 9.5127, 100.0137, source, "2026-08-07T06:01:00Z", True
        )
        replay = engine.build_forecast_snapshot_row(
            "samui_opf_hybrid", 9.5127, 100.0137, source, "2026-08-07T07:01:00Z", True
        )
        self.assertEqual(first["snapshot_hash"], replay["snapshot_hash"])
        self.assertEqual(
            first["source_product"],
            "standard_point_plus_optimized_point_probability_overlay",
        )
        self.assertTrue(first["source_composition"]["optimized_point_probability_overlay"]["applied_to_this_row"])

    def test_missing_issuance_uses_retrieval_fallback(self):
        row = engine.build_forecast_snapshot_row(
            "samui_opf_hybrid",
            9.5127,
            100.0137,
            {
                "valid_time": "2026-08-07T12:00:00Z",
                "issuance_time": None,
                "flat": {
                    "valid_time_utc": "2026-08-07T12:00:00+00:00",
                    "values_json": {},
                },
            },
            "2026-08-07T10:00:00Z",
            False,
        )
        self.assertEqual(row["issuance_time_source"], "retrieval_fallback")
        self.assertEqual(row["forecast_lead_hours"], 2.0)


if __name__ == "__main__":
    unittest.main()
