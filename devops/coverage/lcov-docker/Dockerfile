FROM alpine:3.24


# Install lcov and its dependencies (the pinned alpine base image's default
# repositories already include its community repo)
RUN apk add --no-cache lcov~=2

# Set working directory
WORKDIR /.coverage

# Make sure lcov is in PATH
ENV PATH="/usr/bin:${PATH}"

# Create entrypoint that passes all arguments to lcov
ENTRYPOINT ["lcov"]

# Default command (can be overridden)
CMD ["--help"]