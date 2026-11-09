"""Archive a complete UTC observation day for each futures desk market."""
import argparse
import concurrent.futures
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import math
import subprocess
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
MIN = 60000
VENUES = ['Binance USD-M', 'Bybit Linear']
MARKETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']


def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'TroublesTradingPost-Lab/1'}),timeout=75)


def api(url, **params):
    with request(url+'?'+urllib.parse.urlencode(params)) as response:
        return json.load(response)


def add_row(bars, start, row):
    ts = int(row[0])
    values = list(map(float,row[1:5]))
    if ts % MIN or not all(math.isfinite(v) and v > 0 for v in values):
        raise ValueError('Invalid OHLC row')
    op,hi,lo,cl = values
    if not lo <= min(op,cl) <= max(op,cl) <= hi:
        raise ValueError('Inconsistent OHLC values')
    i=(ts-start)//MIN
    if 0 <= i < len(bars):
        if bars[i] and bars[i] != values:
            raise ValueError('Conflicting candles for same minute')
        bars[i]=values


def historical(day,venue,symbol):
    midnight=int(dt.datetime.combine(day,dt.time(),dt.timezone.utc).timestamp()*1000)
    start=midnight-60*MIN
    bars=[None]*(1440+120)
    end=start+len(bars)*MIN
    sources=[]
    if venue=='Binance USD-M':
        for offset in [-1,0,1]:
            label=day+dt.timedelta(days=offset)
            url=f'https://data.binance.vision/data/futures/um/daily/klines/{symbol}/1m/{symbol}-1m-{label}.zip'
            try:
                with request(url) as r:
                    blob=r.read()
            except HTTPError as error:
                if error.code!=404: raise
                low=max(start,midnight+offset*1440*MIN)
                high=min(end,midnight+(offset+1)*1440*MIN)
                endpoint='https://fapi.binance.com/fapi/v1/klines'
                for first in range(low,high,750*MIN):
                    params=dict(interval='1m',symbol=symbol,startTime=first,endTime=min(first+750*MIN,high)-1,limit=750)
                    for row in api(endpoint,**params): add_row(bars,start,row)
                    sources.append(endpoint+'?'+urllib.parse.urlencode(params))
                continue
            with request(url+'.CHECKSUM') as r:
                expected=r.read().decode().split()[0]
            if hashlib.sha256(blob).hexdigest()!=expected:
                raise ValueError('Source checksum mismatch: '+url)
            with zipfile.ZipFile(io.BytesIO(blob)) as z, z.open(z.namelist()[0]) as f:
                for row in csv.reader(io.TextIOWrapper(f)):
                    if row[0].isdigit(): add_row(bars,start,row)
            sources.append(url)
    else:
        endpoint='https://api.bybit.com/v5/market/kline'
        try:
            for low in range(start,end,800*MIN):
                high=min(low+800*MIN,end)-1
                params=dict(category='linear',symbol=symbol,interval=1,start=low,end=high,limit=1000)
                data=api(endpoint,**params)
                if data['retCode'] or data['result']['symbol']!=symbol:
                    raise ValueError('Bybit rejected historical candle request')
                for row in data['result']['list']: add_row(bars,start,row)
                sources.append(endpoint+'?'+urllib.parse.urlencode(params))
        except URLError:
            # Regional runners can still use the exchange's public historical trade files.
            bars=[None]*len(bars)
            sources=[]
            for offset in [-1,0,1]:
                label=day+dt.timedelta(days=offset)
                url=f'https://public.bybit.com/trading/{symbol}/{symbol}{label}.csv.gz'
                with request(url) as r, gzip.GzipFile(fileobj=r) as gz:
                    previous_ts=0
                    for trade in csv.DictReader(io.TextIOWrapper(gz)):
                        ts=float(trade['timestamp'])*1000
                        if ts < previous_ts: raise ValueError('Unsorted Bybit historical trades')
                        previous_ts=ts
                        if ts<start: continue
                        if ts>=end: break
                        i=int((ts-start)//MIN)
                        p=float(trade['price'])
                        if not math.isfinite(p) or p<=0: raise ValueError('Invalid trade price')
                        if bars[i] is None: bars[i]=[p,p,p,p]
                        else:
                            rbar=bars[i]
                            rbar[1]=max(rbar[1],p); rbar[2]=min(rbar[2],p); rbar[3]=p
                sources.append(url)
    if not any(bars[60:1500]): raise ValueError('Empty historical session')
    funding=None
    try:
        if venue=='Binance USD-M':
            items=api('https://fapi.binance.com/fapi/v1/fundingRate',symbol=symbol,startTime=start,endTime=end-1,limit=100)
            funding=[[int(r['fundingTime']),float(r['fundingRate'])] for r in items]
        else:
            result=api('https://api.bybit.com/v5/market/funding/history',category='linear',symbol=symbol,startTime=start,endTime=end-1,limit=200)
            if result['retCode']: raise ValueError('Bybit rejected funding request')
            funding=[[int(r['fundingRateTimestamp']),float(r['fundingRate'])] for r in result['result']['list']]
    except (URLError,TimeoutError) as e:
        print('Funding unavailable:',symbol,venue,str(e),file=sys.stderr)
    return dict(schema=1,day=str(day),start=start,venue=venue,symbol=symbol,sources=sources,bars=bars,funding=funding)


def save_profile(folder,day,venue,symbol):
    data=historical(day,venue,symbol)
    script="const e=require('./lab-engine.js'), fs=require('fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); console.log(JSON.stringify({rule:e.version,signals:e.record(d)}));"
    derived=subprocess.run(['node','-e',script],input=json.dumps(data),capture_output=True,text=True,cwd=ROOT,check=True)
    data.update(json.loads(derived.stdout))
    name=f"{day}-{'binance' if venue==VENUES[0] else 'bybit'}-{symbol}.json.gz"
    blob=gzip.compress(json.dumps(data,separators=(',',':'),allow_nan=False).encode(),mtime=0)
    (folder/name).write_bytes(blob)
    return dict(venue=venue,symbol=symbol,file=name,sha256=hashlib.sha256(blob).hexdigest(),rule=data['rule'])


def collect(folder,day,manifest):
    if str(day) in manifest['days']: return
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        jobs=[pool.submit(save_profile,folder,day,v,s) for v in VENUES for s in MARKETS]
        manifest['days'][str(day)]=[job.result() for job in jobs]
    (folder/'index.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print('Archived',day,'for all six markets',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',type=Path,default=ROOT/'assets'/'lab')
    parser.add_argument('--day',type=dt.date.fromisoformat)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    index=args.out/'index.json'
    manifest=json.loads(index.read_text()) if index.exists() else {'schema':1,'days':{}}
    # The following day's official daily ZIP must also have been released.
    latest=dt.datetime.now(dt.timezone.utc).date()-dt.timedelta(days=2)
    if args.day: collect(args.out,args.day,manifest)
    else:
        start=dt.date.fromisoformat(max(manifest['days']))+dt.timedelta(days=1) if manifest['days'] else latest
        for offset in range(min(3,(latest-start).days+1)):
            collect(args.out,start+dt.timedelta(days=offset),manifest)
