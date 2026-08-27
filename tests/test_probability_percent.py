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


class ProbabilityPercentTests(unittest.TestCase):
    def test_fraction_becomes_percent(self):
        self.assertEqual(engine.normalize_prob_percent(0.12), 12.0)
        self.assertEqual(engine.normalize_prob_percent(0), 0.0)

    def test_already_percent_passthrough(self):
        self.assertEqual(engine.normalize_prob_percent(12), 12.0)
        self.assertEqual(engine.normalize_prob_percent(100), 100.0)

    def test_one_is_treated_as_fraction_100(self):
        """Spire OPF uses 0–1; 1.0 is 100%, not 1%."""
        self.assertEqual(engine.normalize_prob_percent(1.0), 100.0)

    def test_opf_extract_keeps_raw(self):
        out = engine.extract_opf_probabilities_from_values(
            {"probability_of_thunderstorm": 1.0, "probability_of_fog": 0.08}
        )
        self.assertEqual(out["probability_of_thunderstorm_raw"], 1.0)
        self.assertEqual(out["probability_of_thunderstorm"], 100.0)
        self.assertEqual(out["probability_of_fog_raw"], 0.08)
        self.assertEqual(out["probability_of_fog"], 8.0)


class SkipIfFreshTests(unittest.TestCase):
    def setUp(self):
        self._skip = os.environ.get("SKIP_IF_FRESH_MINUTES")
        self._force = os.environ.get("FORCE_INGEST")

    def tearDown(self):
        if self._skip is None:
            os.environ.pop("SKIP_IF_FRESH_MINUTES", None)
        else:
            os.environ["SKIP_IF_FRESH_MINUTES"] = self._skip
        if self._force is None:
            os.environ.pop("FORCE_INGEST", None)
        else:
            os.environ["FORCE_INGEST"] = self._force

    def test_zero_disables_skip(self):
        os.environ["SKIP_IF_FRESH_MINUTES"] = "0"
        os.environ.pop("FORCE_INGEST", None)
        self.assertIsNone(engine.skip_if_fresh_minutes())

    def test_force_overrides(self):
        os.environ["SKIP_IF_FRESH_MINUTES"] = "50"
        os.environ["FORCE_INGEST"] = "1"
        self.assertIsNone(engine.skip_if_fresh_minutes())

    def test_default_50(self):
        os.environ.pop("SKIP_IF_FRESH_MINUTES", None)
        os.environ.pop("FORCE_INGEST", None)
        self.assertEqual(engine.skip_if_fresh_minutes(), 50)


if __name__ == "__main__":
    unittest.main()
