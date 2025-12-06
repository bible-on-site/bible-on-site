FROM alpine:3.23


# Install lcov and its dependencies
RUN apk add --no-cache --repository http://dl-cdn.alpinelinux.org/alpine/edge/community lcov

# Set working directory
WORKDIR /.coverage

# Make sure lcov is in PATH
ENV PATH="/usr/bin:${PATH}"

# Create entrypoint that passes all arguments to lcov
ENTRYPOINT ["lcov"]

# Default command (can be overridden)
CMD ["--help"]