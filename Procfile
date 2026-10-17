web: daphne -b 0.0.0.0 -p $PORT Backend.asgi:application
worker: celery -A Backend worker -l info --logfile=celery.log
