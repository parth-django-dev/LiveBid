import os
import ssl
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Backend.settings')

# Sanitize any rediss:// in environment variables before Celery loads them
for env_key in ['CELERY_BROKER_URL', 'CELERY_RESULT_BACKEND', 'REDIS_URL']:
    val = os.getenv(env_key)
    if val and 'rediss://' in val and 'ssl_cert_reqs' not in val:
        sep = '&' if '?' in val else '?'
        os.environ[env_key] = f"{val}{sep}ssl_cert_reqs=CERT_REQUIRED"

app = Celery('Backend')

app.config_from_object('django.conf:settings', namespace='CELERY')

# Also explicitly set on app.conf
if 'rediss://' in str(app.conf.broker_url):
    if 'ssl_cert_reqs' not in str(app.conf.broker_url):
        sep = '&' if '?' in str(app.conf.broker_url) else '?'
        app.conf.broker_url = f"{app.conf.broker_url}{sep}ssl_cert_reqs=CERT_REQUIRED"
    app.conf.broker_use_ssl = {'ssl_cert_reqs': ssl.CERT_REQUIRED}

if 'rediss://' in str(app.conf.result_backend):
    if 'ssl_cert_reqs' not in str(app.conf.result_backend):
        sep = '&' if '?' in str(app.conf.result_backend) else '?'
        app.conf.result_backend = f"{app.conf.result_backend}{sep}ssl_cert_reqs=CERT_REQUIRED"
    app.conf.redis_backend_use_ssl = {'ssl_cert_reqs': ssl.CERT_REQUIRED}

app.autodiscover_tasks()