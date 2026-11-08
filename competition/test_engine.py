import unittest
from unittest.mock import patch

from engine import Rejected, apply_order, parse_order
from worker import commit_order, market_quote


def quote(bid, ask, when=1794123798, venue="Kraken Futures"):
    return {"bid":bid, "ask":ask, "time":when, "venue":venue}


class CompetitionTest(unittest.TestCase):
    def setUp(self):
        self.state = {"version":1,"accounts":{},"updated":None}

    def trade(self, ticket, uid, title, prices):
        return apply_order(self.state,ticket,uid,"user"+str(uid),parse_order("[Paper order] "+title),prices)

    def test_independent_accounts_spread_fees_month_year(self):
        self.trade(1,11,"LONG BTC 1000",quote(99,100))
        self.trade(2,12,"SHORT ETH 1000",quote(100,101))
        self.trade(3,11,"CLOSE BTC",quote(110,111))
        self.trade(4,12,"CLOSE ETH",quote(79,80))
        one,two = self.state["accounts"].values()
        self.assertEqual(one["cash"],10098.95)
        self.assertEqual(two["cash"],10199.10)
        self.assertEqual(one["periods"]["2026-11"],{"pnl":98.95,"trades":1})
        self.assertEqual(one["periods"]["2026"],one["periods"]["2026-11"])

    def test_identity_constraints_and_duplicate(self):
        self.trade(3,11,"LONG SOL 1000",quote(100,101))
        for ticket,uid,title in [(3,11,"CLOSE SOL"),(2,11,"CLOSE SOL"),(4,12,"CLOSE SOL"),
                                 (4,11,"CLOSE BTC"),(4,11,"SHORT SOL 20")]:
            with self.assertRaises(Rejected):
                self.trade(ticket,uid,title,quote(99,100))
        with self.assertRaisesRegex(ValueError,"venue"):
            self.trade(4,11,"CLOSE SOL",quote(99,100,venue="Deribit"))

    def test_parser_rejects_client_fills_and_scores(self):
        for title in ["LONG BTC 50000","SHORT BTC -50","LONG ETH 20 price=99","CLOSE SOL 1","LONG BTC 1","LONG BTC 20; echo"]:
            with self.assertRaises(Rejected):
                parse_order("[Paper order] "+title)

    @patch("worker.time.time",return_value=10000)
    @patch("worker.fetch")
    def test_stale_quote_fallback(self,fetch,_time):
        fetch.side_effect = [
            {"tickers":[{"symbol":"PF_XBTUSD","suspended":False,"bid":99,"ask":100}],
             "serverTime":"1970-01-01T00:00:00Z"},
            {"result":{"instrument_name":"BTC-PERPETUAL","state":"open","best_bid_price":101,
                       "best_ask_price":102,"timestamp":10_000_000}},
        ]
        self.assertEqual(market_quote("BTC"),quote(101,102,10000,"Deribit"))

    @patch("worker.github")
    @patch("worker.market_quote",return_value=quote(99,100))
    @patch("worker.read_state")
    def test_worker_uses_issue_author_not_body(self,read,_market,github):
        read.return_value = self.state,"existing-sha"
        issue = {"number":5,"user":{"id":123,"login":"actual-owner"},"title":"[Paper order] LONG BTC 100",
                 "body":"pnl=100000 username=someone-else"}
        commit_order(issue)
        self.assertEqual(list(self.state["accounts"]),["123"])
        self.assertEqual(self.state["accounts"]["123"]["cash"],10_000)
        self.assertEqual(github.call_args.args[1]["sha"],"existing-sha")
